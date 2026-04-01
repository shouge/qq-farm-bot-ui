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
import { setInitialValues, resetSessionGains } from '../../services/stats';
import { initStatusBar, setStatusPlatform } from '../../services/status';
import { toNum } from '../../utils/utils';

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
    setStatusPlatform(config.platform);

    // 注册 WebSocket 错误处理
    this.onWsErrorHandler = (payload: any) => {
      if ((Number(payload?.code) || 0) !== 400) return;
      const now = Date.now();
      if (now - this.wsErrorHandledAt < 4000) return;
      this.wsErrorHandledAt = now;
      this.logger.info('连接被拒绝，可能需要更新 Code', { module: 'system' });
      this.ipc.send({ type: 'ws_error', code: 400, message: payload?.message || '' });
    };
    this.eventBus.on('ws_error', this.onWsErrorHandler);

    this.eventBus.on('kickout', (payload: any) => {
      this.logger.info(`检测到踢下线，准备自动停止。原因: ${payload?.reason || '未知'}`, { module: 'system' });
      this.ipc.send({ type: 'account_kicked', reason: payload?.reason || '未知' });
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
      this.eventBus.off('ws_error', this.onWsErrorHandler);
      this.onWsErrorHandler = null;
    }
    if (this.onSellHandler) {
      this.eventBus.off('sell', this.onSellHandler);
      this.onSellHandler = null;
    }
    if (this.onFarmHarvestedHandler) {
      this.eventBus.off('farmHarvested', this.onFarmHarvestedHandler);
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
    this.eventBus.on('sell', this.onSellHandler);

    // 注册收获后自动出售监听
    this.onFarmHarvestedHandler = async () => {
      if (this.harvestSellRunning) return;
      const auto = this.getAutomationSnapshot();
      if (!auto.sell) return;
      this.harvestSellRunning = true;
      try {
        const { sellAllFruits } = await import('../../services/warehouse');
        await sellAllFruits();
      } catch (e: any) {
        this.logger.warn(`收获后自动出售失败: ${e?.message || ''}`, { module: 'warehouse', event: 'sell_after_harvest' });
      } finally {
        this.harvestSellRunning = false;
      }
    };
    this.eventBus.on('farmHarvested', this.onFarmHarvestedHandler);

    // 登录后主动拉一次背包，初始化点券数量
    try {
      const bagReply = await getBag();
      const items = getBagItems(bagReply);
      let coupon = 0;
      for (const it of (items || [])) {
        if (toNum(it && it.id) === 1002) {
          coupon = toNum(it.count);
          break;
        }
      }
      const state = this.network.getUserState();
      (state as any).coupon = Math.max(0, coupon);
    } catch {
      // ignore
    }

    // 初始化统计基线
    const latest = this.network.getUserState();
    setInitialValues(Number(latest.gold || 0), Number(latest.exp || 0), Number((latest as any).coupon || 0));
    resetSessionGains();

    // 处理邀请码
    await processInviteCodes().catch(() => null);

    // 开启化肥礼包
    const auto = this.getAutomationSnapshot();
    if (auto.fertilizer_gift) {
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

  private getAutomationSnapshot(): Record<string, any> {
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
