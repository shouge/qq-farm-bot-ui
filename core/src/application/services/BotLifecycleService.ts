import type { INetworkClient } from '../../domain/ports/INetworkClient';
import type { IEventBus } from '../../domain/ports/IEventBus';
import type { IWorkerIpc } from '../../domain/ports/IWorkerIpc';
import type { ILogger } from '../../domain/ports/ILogger';
import type { FarmService } from './FarmService';
import type { FriendService } from './FriendService';
import type { DailyRoutineOrchestrator } from './DailyRoutineOrchestrator';
import type { TickScheduler } from './TickScheduler';
import type { ConfigSynchronizer } from './ConfigSynchronizer';
import type { StatusReporter } from './StatusReporter';
import { loadProto } from '../../utils/proto';
import { getBag, getBagItems } from '../../services/warehouse';
import { processInviteCodes } from '../../services/invite';
import { resetSessionGains, setInitialValues } from '../../services/stats';
import { initStatusBar, setStatusPlatform } from '../../services/status';
import { toNum } from '../../utils/utils';
import { AutomationFeature, EventName, ItemId, WebSocketErrorCode, WorkerMessageType } from '../../domain/enums';

export interface StartBotConfig {
  code: string;
  platform: string;
}

export class BotLifecycleService {
  private isRunning = false;
  private loginReady = false;
  private harvestSellRunning = false;
  private onSellHandler: ((deltaGold: unknown) => void) | null = null;
  private onFarmHarvestedHandler: (() => void) | null = null;
  private onWsErrorHandler: ((payload: unknown) => void) | null = null;
  private wsErrorHandledAt = 0;

  constructor(
    private readonly network: INetworkClient,
    private readonly farmService: FarmService,
    private readonly friendService: FriendService,
    private readonly dailyRoutine: DailyRoutineOrchestrator,
    private readonly tickScheduler: TickScheduler,
    private readonly configSync: ConfigSynchronizer,
    private readonly statusReporter: StatusReporter,
    private readonly eventBus: IEventBus,
    private readonly ipc: IWorkerIpc,
    private readonly logger: ILogger
  ) {}

  async start(config: StartBotConfig): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    await loadProto();
    this.logger.info('正在连接服务器...', { module: 'system' });

    // 应用已保存的配置
    const { getConfigSnapshot } = await import('../../models/store');
    this.configSync.apply(getConfigSnapshot(), false);

    initStatusBar();
    setStatusPlatform(config.platform === 'wx' ? 'wx' : 'qq');

    // 注册 WebSocket 错误处理
    this.onWsErrorHandler = (payload: unknown) => {
      const p = payload as { code?: number; message?: string };
      if ((Number(p?.code) || 0) !== WebSocketErrorCode.AUTH_FAILED) return;
      const now = Date.now();
      if (now - this.wsErrorHandledAt < 4000) return;
      this.wsErrorHandledAt = now;
      this.logger.info('连接被拒绝，可能需要更新 Code', { module: 'system' });
      this.ipc.send({ type: WorkerMessageType.WS_ERROR, code: WebSocketErrorCode.AUTH_FAILED, message: p?.message || '' });
    };
    this.eventBus.on(EventName.WS_ERROR, this.onWsErrorHandler);

    this.eventBus.on(EventName.KICKOUT, (payload: unknown) => {
      const p = payload as { reason?: string };
      this.logger.info(`检测到踢下线，准备自动停止。原因: ${p?.reason || '未知'}`, { module: 'system' });
      this.ipc.send({ type: WorkerMessageType.ACCOUNT_KICKED, reason: p?.reason || '未知' });
      setTimeout(() => this.stop().catch(() => null), 200);
    });

    this.network.connect(config.code, async () => {
      this.loginReady = true;
      await this.onLoginSuccess();
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.loginReady = false;

    this.tickScheduler.stop();

    if (this.onWsErrorHandler) {
      this.eventBus.off(EventName.WS_ERROR, this.onWsErrorHandler);
      this.onWsErrorHandler = null;
    }
    if (this.onSellHandler) {
      this.eventBus.off(EventName.SELL, this.onSellHandler);
      this.onSellHandler = null;
    }
    if (this.onFarmHarvestedHandler) {
      this.eventBus.off(EventName.FARM_HARVESTED, this.onFarmHarvestedHandler);
      this.onFarmHarvestedHandler = null;
    }

    this.network.disconnect();
  }

  private async onLoginSuccess(): Promise<void> {
    // 注册出售收益监听
    this.onSellHandler = (deltaGold: unknown) => {
      const delta = Number(deltaGold || 0);
      if (!Number.isFinite(delta) || delta <= 0) return;
      const { recordOperation } = require('../../services/stats');
      recordOperation('sell', 1);
    };
    this.eventBus.on(EventName.SELL, this.onSellHandler);

    // 注册收获后自动出售监听
    this.onFarmHarvestedHandler = async () => {
      if (this.harvestSellRunning) return;
      const auto = this.getAutomationSnapshot();
      if (!auto[AutomationFeature.SELL]) return;
      this.harvestSellRunning = true;
      try {
        const { sellAllFruits } = await import('../../services/warehouse');
        await sellAllFruits();
      } catch (e) {
        this.logger.warn(`收获后自动出售失败: ${e instanceof Error ? e.message : String(e)}`, { module: 'warehouse', event: 'sell_after_harvest' });
      } finally {
        this.harvestSellRunning = false;
      }
    };
    this.eventBus.on(EventName.FARM_HARVESTED, this.onFarmHarvestedHandler);

    // 登录后主动拉一次背包，初始化点券数量
    try {
      const bagReply = await getBag();
      const items = getBagItems(bagReply);
      let coupon = 0;
      for (const it of (items || [])) {
        if (toNum(it && it.id) === ItemId.COUPON) {
          coupon = toNum(it.count);
          break;
        }
      }
      const state = this.network.getUserState();
      (state as { coupon: number }).coupon = Math.max(0, coupon);
    } catch {
      // ignore
    }

    // 初始化统计基线
    const latest = this.network.getUserState();
    setInitialValues(Number(latest.gold || 0), Number(latest.exp || 0), Number(latest.coupon || 0));
    resetSessionGains();

    // 处理邀请码
    await processInviteCodes().catch(() => null);

    // 开启化肥礼包
    const auto = this.getAutomationSnapshot();
    if (auto[AutomationFeature.FERTILIZER_GIFT]) {
      const { openFertilizerGiftPacksSilently } = await import('../../services/warehouse');
      await openFertilizerGiftPacksSilently().catch(() => 0);
    }

    // 启动日常任务
    await this.dailyRoutine.runAll(true);

    // 启动调度器
    this.tickScheduler.start();

    // 启动定时状态同步
    // (TickScheduler 不负责状态同步，BotLifecycleService 自己管理)
    // 使用 configSync 的 scheduler? No, we don't have direct access to it.
    // We'll rely on the caller or use a simple interval via the injected IScheduler
    // But actually we don't have a direct scheduler reference here.
    // StatusReporter should be driven by TickScheduler or external timer.
    // For now, we report once at login.
    this.statusReporter.report({
      farmTaskRunning: false,
      friendTaskRunning: false,
      nextFarmRunAt: Date.now(),
      nextFriendRunAt: Date.now(),
    });
  }

  private getAutomationSnapshot(): Record<string, unknown> {
    // 暂时直接读取 store；后续可通过 IConfigRepository 获取
    const { getAutomation } = require('../../models/store');
    return getAutomation() || {};
  }

  isLoggedIn(): boolean {
    return this.loginReady;
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
