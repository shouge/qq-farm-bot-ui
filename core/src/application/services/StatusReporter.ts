import type { INetworkClient } from '../../domain/ports/INetworkClient';
import type { IConfigRepository } from '../../domain/ports/IConfigRepository';
import type { IWorkerIpc } from '../../domain/ports/IWorkerIpc';
import { getLevelExpProgress } from '../../config/gameConfig';

export interface PanelStatus {
  connection: { connected: boolean };
  status: Record<string, unknown>;
  automation: Record<string, unknown>;
  preferredSeed: number;
  levelProgress: ReturnType<typeof getLevelExpProgress> | null;
  configRevision: number;
  nextChecks: {
    farmRemainSec: number;
    friendRemainSec: number;
    farmInspecting: boolean;
    friendInspecting: boolean;
    farmWaiting: boolean;
    friendWaiting: boolean;
  };
}

export class StatusReporter {
  private lastStatusHash = '';
  private lastStatusSentAt = 0;
  private appliedConfigRevision = 0;

  constructor(
    private readonly network: INetworkClient,
    private readonly configRepo: IConfigRepository,
    private readonly ipc: IWorkerIpc
  ) {}

  setRevision(rev: number): void {
    this.appliedConfigRevision = rev;
  }

  report(
    options: {
      farmTaskRunning: boolean;
      friendTaskRunning: boolean;
      nextFarmRunAt: number;
      nextFriendRunAt: number;
    }
  ): void {
    const userState = this.network.getUserState();
    const connected = this.network.isConnected();

    const level = userState.level || 0;
    const exp = userState.exp || 0;
    const expProgress = level > 0 && exp >= 0 ? getLevelExpProgress(level, exp) : null;

    const nowMs = Date.now();
    const farmRemainSec = Math.max(0, Math.ceil((options.nextFarmRunAt - nowMs) / 1000));
    const friendRemainSec = Math.max(0, Math.ceil((options.nextFriendRunAt - nowMs) / 1000));

    const fullStats: Record<string, unknown> = {
      connection: { connected },
      status: {
        gid: userState.gid,
        name: userState.name,
        level,
        gold: userState.gold,
        exp,
        coupon: userState.coupon,
      },
      automation: this.configRepo.getAutomation(),
      preferredSeed: this.configRepo.getPreferredSeedId(),
      levelProgress: expProgress,
      configRevision: this.appliedConfigRevision,
      nextChecks: {
        farmRemainSec,
        friendRemainSec,
        farmInspecting: options.farmTaskRunning,
        friendInspecting: options.friendTaskRunning,
        farmWaiting: farmRemainSec <= 0 && !options.farmTaskRunning,
        friendWaiting: friendRemainSec <= 0 && !options.friendTaskRunning,
      },
    };

    const hash = JSON.stringify(fullStats);
    const now = Date.now();
    if (hash !== this.lastStatusHash || now - this.lastStatusSentAt > 8000) {
      this.lastStatusHash = hash;
      this.lastStatusSentAt = now;
      this.ipc.send({ type: 'status_sync', data: fullStats });
    }
  }
}
