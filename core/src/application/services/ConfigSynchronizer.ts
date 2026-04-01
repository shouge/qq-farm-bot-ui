import type { IConfigRepository } from '../../domain/ports/IConfigRepository';
import type { INetworkClient } from '../../domain/ports/INetworkClient';
import type { IScheduler } from '../../domain/ports/IScheduler';
import type { ILogger } from '../../domain/ports/ILogger';
import type { FullConfigSnapshot } from '../../domain/ports/IConfigRepository';

export class ConfigSynchronizer {
  constructor(
    private readonly configRepo: IConfigRepository,
    private readonly network: INetworkClient,
    private readonly scheduler: IScheduler,
    private readonly logger: ILogger,
    private readonly onReconnect?: () => void
  ) {}

  apply(snapshot: Partial<FullConfigSnapshot> & { __delta?: boolean; __revision?: number }, syncNow = false): void {
    const isDelta = !!snapshot.__delta;
    const incomingIntervals = snapshot.intervals;

    // Apply config
    if (isDelta) {
      const currentFull = this.configRepo.getConfigSnapshot();
      const merged = { ...currentFull, ...snapshot };
      delete (merged as any).__delta;
      this.configRepo.applyConfigSnapshot(merged);
    } else {
      this.configRepo.applyConfigSnapshot(snapshot);
    }

    if (incomingIntervals) {
      this.applyIntervalsToRuntime(incomingIntervals);
    }

    if (syncNow && this.onReconnect) {
      const jitter = 300 + Math.floor(Math.random() * 700);
      this.scheduler.setTimeout('runtime_client_reconnect', jitter, () => {
        this.onReconnect?.();
      });
    }
  }

  private applyIntervalsToRuntime(intervals: Partial<FullConfigSnapshot['intervals']>): void {
    const { CONFIG } = require('../../config/config');
    const data = intervals || {};

    const farmLegacy = Math.max(1, parseInt(String(data.farm), 10) || 2);
    const farmMin = Math.max(1, parseInt(String(data.farmMin), 10) || farmLegacy);
    const farmMax = Math.max(farmMin, parseInt(String(data.farmMax), 10) || farmLegacy);
    CONFIG.farmCheckIntervalMin = farmMin * 1000;
    CONFIG.farmCheckIntervalMax = farmMax * 1000;
    CONFIG.farmCheckInterval = CONFIG.farmCheckIntervalMin;

    const friendLegacy = Math.max(1, parseInt(String(data.friend), 10) || 10);
    const friendMin = Math.max(1, parseInt(String(data.friendMin), 10) || friendLegacy);
    const friendMax = Math.max(friendMin, parseInt(String(data.friendMax), 10) || friendLegacy);
    CONFIG.friendCheckIntervalMin = friendMin * 1000;
    CONFIG.friendCheckIntervalMax = friendMax * 1000;
    CONFIG.friendCheckInterval = CONFIG.friendCheckIntervalMin;
  }
}
