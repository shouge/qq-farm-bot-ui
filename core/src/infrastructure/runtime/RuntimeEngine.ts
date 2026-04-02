import process from 'node:process';
import path from 'node:path';
import type { IEventPublisher, NoOpEventPublisher } from '../../domain/ports/IEventPublisher';
import { RuntimeStateService } from './RuntimeStateService';
import { WorkerProcessManager } from './WorkerProcessManager';
import { PanelDataProvider } from './PanelDataProvider';
import { ReloginReminderService } from './ReloginReminderService';
import { MiniProgramLoginSession } from '../../services/qrlogin';
import { sendPushooMessage } from '../../services/push';
import * as store from '../../models/store';

const OPERATION_KEYS = [
  'harvest', 'water', 'weed', 'bug', 'fertilize', 'plant', 'steal',
  'helpWater', 'helpWeed', 'helpBug', 'taskClaim', 'sell', 'upgrade',
];

export interface RuntimeEngineOptions {
  runtimeMode?: string;
  mainEntryPath: string;
  workerScriptPath: string;
}

export class RuntimeEngine {
  private runtimeState: RuntimeStateService;
  private workerManager: WorkerProcessManager;
  private panelDataProvider: PanelDataProvider;
  private reloginReminder: ReloginReminderService;
  private eventPublisher: IEventPublisher = { publish: () => {}, publishTo: () => {}, isReady: () => false };

  constructor(private readonly opts: RuntimeEngineOptions) {
    this.runtimeState = new RuntimeStateService({ store, operationKeys: OPERATION_KEYS });

    this.reloginReminder = new ReloginReminderService({
      store,
      miniProgramLoginSession: MiniProgramLoginSession,
      sendPushooMessage,
      log: (tag, msg, extra) => this.runtimeState.log(tag, msg, extra),
      addAccountLog: (action, msg, accountId, accountName, extra) => this.runtimeState.addAccountLog(action, msg, accountId, accountName, extra),
    });

    this.workerManager = new WorkerProcessManager({
      runtimeMode: opts.runtimeMode,
      mainEntryPath: opts.mainEntryPath,
      workerScriptPath: opts.workerScriptPath,
      runtimeState: this.runtimeState,
      getOfflineAutoDeleteMs: () => this.reloginReminder.getOfflineAutoDeleteMs(),
      triggerOfflineReminder: (payload) => this.reloginReminder.triggerOfflineReminder(payload),
      addOrUpdateAccount: (account) => store.addOrUpdateAccount(account),
      deleteAccount: (id) => store.deleteAccount(id),
      upsertFriendBlacklist: (accountId, gid) => {
        const id = String(accountId || '').trim();
        const friendGid = Number(gid);
        if (!id || !Number.isFinite(friendGid) || friendGid <= 0) return false;
        const current = store.getFriendBlacklist ? store.getFriendBlacklist(id) : [];
        const list = Array.isArray(current) ? current : [];
        if (list.includes(friendGid)) return false;
        if (store.setFriendBlacklist) {
          store.setFriendBlacklist(id, [...list, friendGid]);
          return true;
        }
        return false;
      },
      broadcastConfigToWorkers: (targetAccountId = '') => this.broadcastConfigToWorkers(targetAccountId),
      onStatusSync: (accountId, status, accountName) => {
        this.runtimeState.runtimeEvents.emit('status', { accountId, status, accountName });
        if (!this.eventPublisher.isReady()) return;
        this.eventPublisher.publishTo(`account:${accountId}`, 'status:update', { accountId, status });
        this.eventPublisher.publishTo('account:all', 'status:update', { accountId, status });
      },
      onWorkerLog: (entry: RuntimeLogEntry, accountId, accountName) => {
        this.runtimeState.runtimeEvents.emit('worker_log', { entry, accountId, accountName });
        if (!this.eventPublisher.isReady()) return;
        const id = String(entry?.accountId || accountId || '').trim();
        if (id) this.eventPublisher.publishTo(`account:${id}`, 'log:new', entry);
        this.eventPublisher.publishTo('account:all', 'log:new', entry);
      },
    });

    // Resolve circular dependency via setter
    this.reloginReminder.setWorkerManager(this.workerManager);

    this.panelDataProvider = new PanelDataProvider(
      this.workerManager,
      this.runtimeState,
      store,
      (targetAccountId = '') => this.broadcastConfigToWorkers(targetAccountId)
    );

    this.runtimeState.runtimeEvents.on('log', (entry: RuntimeLogEntry) => {
      if (!this.eventPublisher.isReady()) return;
      const id = String(entry?.accountId || '').trim();
      if (id) this.eventPublisher.publishTo(`account:${id}`, 'log:new', entry);
      this.eventPublisher.publishTo('account:all', 'log:new', entry);
    });

    this.runtimeState.runtimeEvents.on('account_log', (entry: AccountLogEntry) => {
      if (!this.eventPublisher.isReady()) return;
      const id = String(entry?.accountId || '').trim();
      if (id) this.eventPublisher.publishTo(`account:${id}`, 'account-log:new', entry);
      this.eventPublisher.publishTo('account:all', 'account-log:new', entry);
    });
  }

  async start(options: { autoStartAccounts?: boolean } = {}): Promise<void> {
    const shouldAutoStartAccounts = options.autoStartAccounts !== false;

    if (shouldAutoStartAccounts) {
      this.startAllAccounts();
    }
  }

  stopAllAccounts(): void {
    for (const accountId of Object.keys(this.runtimeState.workers)) {
      this.workerManager.stopWorker(accountId);
    }
  }

  startAllAccounts(): void {
    const accounts = (store.getAccounts().accounts || []) as Array<{ id: string; name: string; code: string; platform: string }>;
    if (accounts.length > 0) {
      this.runtimeState.log('系统', `发现 ${accounts.length} 个账号，正在启动...`);
      accounts.forEach((acc) => this.workerManager.startWorker(acc));
    } else {
      this.runtimeState.log('系统', '未发现账号，请访问管理面板添加账号');
    }
  }

  private broadcastConfigToWorkers(targetAccountId = ''): void {
    const targetId = String(targetAccountId || '').trim();
    for (const [accId, worker] of Object.entries(this.runtimeState.workers)) {
      if (targetId && String(accId) !== targetId) continue;
      const config = this.runtimeState.buildConfigDeltaForAccount(accId);
      if (!config) continue;
      try {
        (worker.process as { send?: (msg: unknown) => void }).send?.({ type: 'config_sync', config });
      } catch {
        // ignore IPC failures for exited workers
      }
    }
  }

  getPanelDataProvider(): PanelDataProvider {
    return this.panelDataProvider;
  }

  getRuntimeState(): RuntimeStateService {
    return this.runtimeState;
  }

  getWorkerManager(): WorkerProcessManager {
    return this.workerManager;
  }

  setEventPublisher(publisher: IEventPublisher): void {
    this.eventPublisher = publisher;
  }
}

// Import types for event handlers
import type { RuntimeLogEntry, AccountLogEntry } from '../../domain/ports/IRuntimeStateService';
