import type { INetworkClient } from '../../domain/ports/INetworkClient';
import type { IConfigRepository } from '../../domain/ports/IConfigRepository';
import type { IScheduler } from '../../domain/ports/IScheduler';
import type { ILogger } from '../../domain/ports/ILogger';
import { ProtocolFacade } from '../../infrastructure/network/ProtocolFacade';
import { FriendOperationLimiter } from './FriendOperationLimiter';
import { toNum, sleep } from '../../utils/utils';
import type { FriendPreview, FriendCandidate } from '../../domain/entities';

const IDLE_FRIEND_PROBE_BATCH_SIZE = 12;
const IDLE_FRIEND_PROBE_REDUCED_BATCH_SIZE = 6;
const IDLE_FRIEND_PROBE_SKIP_THRESHOLD = 24;
const IDLE_FRIEND_PROBE_MISS_COOLDOWN_MS = 20 * 60 * 1000;
const IDLE_FRIEND_PROBE_HIT_COOLDOWN_MS = 2 * 60 * 1000;

export type FriendOpType = 'steal' | 'water' | 'weed' | 'bug' | 'bad';

export class FriendService {
  private readonly protocol: ProtocolFacade;
  private readonly limiter: FriendOperationLimiter;
  private readonly idleFriendProbeCooldownUntil = new Map<number, number>();
  private idleFriendProbeCursor = 0;
  private isCheckingFriends = false;

  constructor(
    network: INetworkClient,
    private readonly configRepo: IConfigRepository,
    private readonly scheduler: IScheduler,
    private readonly logger: ILogger
  ) {
    this.protocol = new ProtocolFacade(network);
    this.limiter = new FriendOperationLimiter();
  }

  async inspectFriends(): Promise<boolean> {
    if (this.isCheckingFriends) return false;
    if (!this.configRepo.isAutomationOn('friend')) return false;

    const helpEnabled = this.configRepo.isAutomationOn('friend_help');
    const stopWhenExpLimit = this.configRepo.isAutomationOn('friend_help_exp_limit');
    const helpScanEnabled = helpEnabled && (!stopWhenExpLimit || this.limiter.isHelpEnabled(stopWhenExpLimit));
    const stealEnabled = this.configRepo.isAutomationOn('friend_steal');
    const badEnabled = this.configRepo.isAutomationOn('friend_bad');

    if (!helpScanEnabled && !stealEnabled && !badEnabled) return false;
    if (this.inQuietHours()) return false;

    this.isCheckingFriends = true;
    this.limiter.checkDailyReset();

    try {
      const friendsReply = await this.protocol.syncAllFriends();
      const friends = (friendsReply.game_friends || []).map((f) => this.toFriendPreview(f));
      if (friends.length === 0) {
        this.logger.info('没有好友', { module: 'friend', event: 'friend_scan' });
        return false;
      }

      const state = { gid: 0 }; // To be injected properly later
      const blacklist = new Set(this.configRepo.getFriendBlacklist());
      const blockCfg = this.configRepo.getFriendBlockLevel();
      const canPutBugOrWeed = this.limiter.canOperate(10004) || this.limiter.canOperate(10003);

      const priorityFriends: FriendCandidate[] = [];
      const idleProbeCandidates: FriendCandidate[] = [];
      const visitedGids = new Set<number>();

      for (const f of friends) {
        const gid = f.gid;
        if (gid === state.gid) continue;
        if (visitedGids.has(gid)) continue;
        if (blacklist.has(gid)) continue;
        if ((f.name === '小小农夫') && f.level <= 1) continue;
        if (blockCfg.enabled && f.level <= blockCfg.Level) continue;

        const hasStealAction = stealEnabled && (f.plant?.stealNum || 0) > 0;
        const hasHelpAction = helpScanEnabled && ((f.plant?.dryNum || 0) > 0 || (f.plant?.weedNum || 0) > 0 || (f.plant?.insectNum || 0) > 0);

        if (hasStealAction || hasHelpAction) {
          priorityFriends.push({ gid, name: f.name, level: f.level, stealNum: f.plant?.stealNum, dryNum: f.plant?.dryNum, weedNum: f.plant?.weedNum, insectNum: f.plant?.insectNum, isPriority: true });
          visitedGids.add(gid);
        } else if ((badEnabled && canPutBugOrWeed) || helpScanEnabled || stealEnabled) {
          idleProbeCandidates.push({ gid, name: f.name, level: f.level, isPriority: false });
          visitedGids.add(gid);
        }
      }

      priorityFriends.sort((a, b) => {
        if ((b.stealNum || 0) !== (a.stealNum || 0)) return (b.stealNum || 0) - (a.stealNum || 0);
        const helpA = (a.dryNum || 0) + (a.weedNum || 0) + (a.insectNum || 0);
        const helpB = (b.dryNum || 0) + (b.weedNum || 0) + (b.insectNum || 0);
        return helpB - helpA;
      });

      const budget = this.getProbeBudget(priorityFriends.length);
      const probeFriends = this.selectProbeCandidates(idleProbeCandidates, budget);
      const friendsToVisit = [...priorityFriends, ...probeFriends];

      if (friendsToVisit.length === 0) return false;

      const totalActions = { steal: 0, water: 0, weed: 0, bug: 0, putBug: 0, putWeed: 0 };
      let visitedCount = 0;
      let probeVisitedCount = 0;

      for (const friend of friendsToVisit) {
        try {
          const result = await this.visitFriend(friend, totalActions);
          visitedCount++;
          if (friend.isProbe) {
            probeVisitedCount++;
            this.markProbeCooldown(friend.gid, result.acted);
          }
        } catch {
          if (friend.isProbe) {
            probeVisitedCount++;
            this.markProbeCooldown(friend.gid, false);
          }
        }
        await sleep(200);
      }

      const summary: string[] = [];
      if (totalActions.steal > 0) summary.push(`偷${totalActions.steal}`);
      if (totalActions.weed > 0) summary.push(`除草${totalActions.weed}`);
      if (totalActions.bug > 0) summary.push(`除虫${totalActions.bug}`);
      if (totalActions.water > 0) summary.push(`浇水${totalActions.water}`);
      if (totalActions.putBug > 0) summary.push(`放虫${totalActions.putBug}`);
      if (totalActions.putWeed > 0) summary.push(`放草${totalActions.putWeed}`);

      if (summary.length > 0) {
        this.logger.info(`巡查 ${friendsToVisit.length} 人 → ${summary.join('/')}`, { module: 'friend', event: 'friend_cycle', visited: visitedCount, summary });
      }
      return summary.length > 0;
    } catch (e: any) {
      this.logger.warn(`巡查异常: ${e?.message || ''}`, { module: 'friend', event: 'friend_scan' });
      return false;
    } finally {
      this.isCheckingFriends = false;
    }
  }

  async getFriendsList(): Promise<Record<string, unknown>> {
    const reply = await this.protocol.syncAllFriends();
    return reply as unknown as Record<string, unknown>;
  }

  async getFriendLandsDetail(friendGid: number): Promise<Record<string, unknown>> {
    const reply = await this.protocol.enterFriendFarm(friendGid);
    return reply as unknown as Record<string, unknown>;
  }

  async doManualOperation(friendGid: number, opType: string): Promise<Record<string, unknown>> {
    const result = await this.visitFriend({ gid: friendGid, name: `GID:${friendGid}`, level: 0 }, {});
    return { success: result.acted, opType };
  }

  private async visitFriend(friend: FriendCandidate, totalActions: Record<string, number>): Promise<{ acted: boolean }> {
    const { gid, name = `GID:${friend.gid}` } = friend;

    try {
      const enterReply = await this.protocol.enterFriendFarm(gid);
      const lands = enterReply.lands || [];
      if (lands.length === 0) {
        await this.protocol.leaveFriendFarm(gid);
        return { acted: false };
      }

      const actions: string[] = [];
      const helpEnabled = this.configRepo.isAutomationOn('friend_help');
      const stopWhenExpLimit = this.configRepo.isAutomationOn('friend_help_exp_limit');

      // Help operations simplified
      // Steal
      if (this.configRepo.isAutomationOn('friend_steal')) {
        // Simplified - would analyze lands and steal
      }

      // Bad operations
      if (this.configRepo.isAutomationOn('friend_bad')) {
        // Simplified - would put weeds/bugs
      }

      await this.protocol.leaveFriendFarm(gid);
      return { acted: actions.length > 0 };
    } catch (e: any) {
      await this.protocol.leaveFriendFarm(gid).catch(() => null);
      return { acted: false };
    }
  }

  private getProbeBudget(priorityCount: number): number {
    const count = Math.max(0, priorityCount || 0);
    if (count >= IDLE_FRIEND_PROBE_SKIP_THRESHOLD) return 0;
    if (count >= Math.floor(IDLE_FRIEND_PROBE_SKIP_THRESHOLD / 2)) return IDLE_FRIEND_PROBE_REDUCED_BATCH_SIZE;
    return IDLE_FRIEND_PROBE_BATCH_SIZE;
  }

  private selectProbeCandidates(candidates: FriendCandidate[], budget: number): FriendCandidate[] {
    const nowMs = Date.now();
    this.pruneProbeCooldown(nowMs);
    const total = candidates.length;
    if (total === 0 || budget <= 0) return [];

    let cursor = this.idleFriendProbeCursor % total;
    if (cursor < 0) cursor = 0;

    const selected: FriendCandidate[] = [];
    let scanned = 0;
    while (scanned < total && selected.length < budget) {
      const friend = candidates[cursor];
      if (friend) {
        const gid = friend.gid;
        const cooldownUntil = this.idleFriendProbeCooldownUntil.get(gid) || 0;
        if (!this.idleFriendProbeCooldownUntil.has(gid) || cooldownUntil <= nowMs) {
          selected.push({ ...friend, isProbe: true });
        }
      }
      cursor = (cursor + 1) % total;
      scanned++;
    }

    this.idleFriendProbeCursor = cursor;
    return selected;
  }

  private pruneProbeCooldown(nowMs: number): void {
    for (const [gid, until] of this.idleFriendProbeCooldownUntil.entries()) {
      if (until <= nowMs) this.idleFriendProbeCooldownUntil.delete(gid);
    }
  }

  private markProbeCooldown(gid: number, hadAction: boolean): void {
    const nowMs = Date.now();
    this.idleFriendProbeCooldownUntil.set(gid, nowMs + (hadAction ? IDLE_FRIEND_PROBE_HIT_COOLDOWN_MS : IDLE_FRIEND_PROBE_MISS_COOLDOWN_MS));
  }

  private inQuietHours(): boolean {
    const cfg = this.configRepo.getFriendQuietHours();
    if (!cfg.enabled) return false;
    const [sh, sm] = cfg.start.split(':').map(Number);
    const [eh, em] = cfg.end.split(':').map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return false;

    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const start = sh * 60 + sm;
    const end = eh * 60 + em;

    if (start === end) return true;
    if (start < end) return cur >= start && cur < end;
    return cur >= start || cur < end;
  }

  private toFriendPreview(raw: any): FriendPreview {
    return {
      gid: toNum(raw.gid),
      name: String(raw.remark || raw.name || '').trim() || `GID:${toNum(raw.gid)}`,
      avatarUrl: String(raw.avatar_url || '').trim(),
      level: toNum(raw.level || 1),
      plant: raw.plant
        ? {
            stealNum: toNum(raw.plant.steal_plant_num),
            dryNum: toNum(raw.plant.dry_num),
            weedNum: toNum(raw.plant.weed_num),
            insectNum: toNum(raw.plant.insect_num),
          }
        : null,
    };
  }
}
