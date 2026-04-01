import type { WorkerMessage, IWorkerIpc } from '../../domain/ports/IWorkerIpc';
import type { BotLifecycleService, StartBotConfig } from '../../application/services/BotLifecycleService';
import type { ConfigSynchronizer } from '../../application/services/ConfigSynchronizer';
import type { ILogger } from '../../domain/ports/ILogger';
import type { FarmService } from '../../application/services/FarmService';
import type { FriendService } from '../../application/services/FriendService';
import { bridgeLegacyApiCall } from './LegacyApiBridge';

export class WorkerMessageDispatcher {
  constructor(
    private readonly bot: BotLifecycleService,
    private readonly configSync: ConfigSynchronizer,
    private readonly farmService: FarmService,
    private readonly friendService: FriendService,
    private readonly ipc: IWorkerIpc,
    private readonly logger: ILogger
  ) {}

  async dispatch(msg: WorkerMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'start': {
          const cfg = msg.config as StartBotConfig;
          await this.bot.start(cfg);
          break;
        }
        case 'stop': {
          await this.bot.stop();
          break;
        }
        case 'config_sync': {
          this.configSync.apply(msg.config as Record<string, unknown>, true);
          break;
        }
        case 'api_call': {
          await this.handleApiCall(msg.id, msg.method, msg.args);
          break;
        }
      }
    } catch (e: any) {
      this.ipc.send({ type: 'error', error: e?.message || String(e) });
    }
  }

  private async handleApiCall(id: number, method: string, args: unknown[]): Promise<void> {
    let result: unknown = null;
    let error: string | null = null;

    try {
      switch (method) {
        case 'getLands':
          result = await this.farmService.getLandsDetail();
          break;
        case 'getFriends':
          result = await this.friendService.getFriendsList();
          break;
        case 'getFriendLands':
          result = await this.friendService.getFriendLandsDetail(args[0] as number);
          break;
        case 'doFarmOp':
          result = await this.farmService.performFullCycle();
          break;
        case 'doSingleLandOp': {
          const raw = (args[0] || {}) as Record<string, unknown>;
          const payload = {
            action: String(raw.action || ''),
            landId: Number(raw.landId || 0),
            seedId: raw.seedId !== undefined ? Number(raw.seedId) : undefined,
          };
          result = await this.farmService.performManualOperation(payload);
          break;
        }
        case 'doFriendOp':
          result = await this.friendService.doManualOperation(args[0] as number, args[1] as string);
          break;
        case 'getSeeds':
          result = await this.farmService.getAvailableSeeds();
          break;
        default: {
          const bridged = await bridgeLegacyApiCall(method, args);
          if (bridged.error != null) {
            error = bridged.error;
          } else {
            result = bridged.result;
          }
        }
      }
    } catch (e: any) {
      error = e?.message || String(e);
    }

    this.ipc.send({ type: 'api_response', id, result, error: error || undefined });
  }
}
