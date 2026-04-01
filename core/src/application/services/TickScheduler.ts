import type { IScheduler } from '../../domain/ports/IScheduler';
import type { IConfigRepository } from '../../domain/ports/IConfigRepository';
import type { ILogger } from '../../domain/ports/ILogger';
import type { FarmService } from './FarmService';
import type { FriendService } from './FriendService';

export class TickScheduler {
  private isRunning = false;
  private nextFarmAt = 0;
  private nextFriendAt = 0;
  private farmTaskRunning = false;
  private friendTaskRunning = false;

  constructor(
    private readonly scheduler: IScheduler,
    private readonly farmService: FarmService,
    private readonly friendService: FriendService,
    private readonly configRepo: IConfigRepository,
    private readonly logger: ILogger
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.resetSchedule();
    this.scheduleNextTick();
  }

  stop(): void {
    this.isRunning = false;
    this.farmTaskRunning = false;
    this.friendTaskRunning = false;
    this.scheduler.clear('unified_next_tick');
  }

  resetSchedule(): void {
    const intervals = this.configRepo.getIntervals();
    const farmMs = this.randomIntervalMs(
      (intervals.farmMin || intervals.farm || 2) * 1000,
      (intervals.farmMax || intervals.farm || 2) * 1000
    );
    const friendMs = this.randomIntervalMs(
      (intervals.friendMin || intervals.friend || 10) * 1000,
      (intervals.friendMax || intervals.friend || 10) * 1000
    );
    const now = Date.now();
    this.nextFarmAt = now + farmMs;
    this.nextFriendAt = now + friendMs;
  }

  private scheduleNextTick(): void {
    if (!this.isRunning) return;
    this.scheduler.clear('unified_next_tick');

    const now = Date.now();
    const nextAt = Math.min(this.nextFarmAt || now + 1000, this.nextFriendAt || now + 1000);
    const delayMs = Math.max(1000, nextAt - now);

    this.scheduler.setTimeout('unified_next_tick', delayMs, async () => {
      try {
        await this.runTick();
      } finally {
        if (this.isRunning) {
          this.scheduleNextTick();
        }
      }
    });
  }

  private async runTick(): Promise<void> {
    if (!this.isRunning) return;
    const now = Date.now();
    const dueFarm = now >= this.nextFarmAt;
    const dueFriend = now >= this.nextFriendAt;
    if (!dueFarm && !dueFriend) return;

    const tasks: Promise<void>[] = [];
    if (dueFarm && !this.farmTaskRunning) {
      tasks.push(this.runFarmTick());
    }
    if (dueFriend && !this.friendTaskRunning) {
      tasks.push(this.runFriendTick());
    }
    await Promise.all(tasks);
  }

  private async runFarmTick(): Promise<void> {
    if (this.farmTaskRunning) return;
    this.farmTaskRunning = true;
    const intervals = this.configRepo.getIntervals();
    const farmMs = this.randomIntervalMs(
      (intervals.farmMin || intervals.farm || 2) * 1000,
      (intervals.farmMax || intervals.farm || 2) * 1000
    );
    try {
      await this.farmService.inspectFarm();
    } catch (e: any) {
      this.logger.warn(`农场调度执行失败: ${e?.message || ''}`, { module: 'system', event: 'farm_tick' });
    } finally {
      this.nextFarmAt = Date.now() + farmMs;
      this.farmTaskRunning = false;
    }
  }

  private async runFriendTick(): Promise<void> {
    if (this.friendTaskRunning) return;
    this.friendTaskRunning = true;
    const intervals = this.configRepo.getIntervals();
    const friendMs = this.randomIntervalMs(
      (intervals.friendMin || intervals.friend || 10) * 1000,
      (intervals.friendMax || intervals.friend || 10) * 1000
    );
    try {
      await this.friendService.inspectFriends();
    } catch (e: any) {
      this.logger.warn(`好友调度执行失败: ${e?.message || ''}`, { module: 'system', event: 'friend_tick' });
    } finally {
      this.nextFriendAt = Date.now() + friendMs;
      this.friendTaskRunning = false;
    }
  }

  private randomIntervalMs(minMs: number, maxMs: number): number {
    const minSec = Math.max(1, Math.floor(Math.max(1000, minMs || 1000) / 1000));
    const maxSec = Math.max(minSec, Math.floor(Math.max(1000, maxMs || minSec * 1000) / 1000));
    if (maxSec === minSec) return minSec * 1000;
    const sec = minSec + Math.floor(Math.random() * (maxSec - minSec + 1));
    return sec * 1000;
  }
}
