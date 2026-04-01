import process from 'node:process';
import path from 'node:path';
import type { AdminServer } from '../../interface/http/AdminServer';
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
  adminServer: AdminServer;
  runtimeMode?: string;
  mainEntryPath: string;
  workerScriptPath: string;
}

export class RuntimeEngine {
  private runtimeState: RuntimeStateService;
  private workerManager: WorkerProcessManager;
  private panelDataProvider: PanelDataProvider;
  private reloginReminder: ReloginReminderService;

  constructor(private readonly opts: RuntimeEngineOptions) {
    this.runtimeState = new RuntimeStateService({ store, operationKeys: OPERATION_KEYS });

    this.reloginReminder = new ReloginReminderService({
      store,
      miniProgramLoginSession: MiniProgramLoginSession,
      sendPushooMessage,
      log: (tag, msg, extra) => this.runtimeState.log(tag, msg, extra),
      addAccountLog: (action, msg, accountId, accountName, extra) => this.runtimeState.addAccountLog(action, msg, accountId, accountName, extra),
      getAccounts: () => store.getAccounts(),
      addOrUpdateAccount: (account) => store.addOrUpdateAccount(account),
      workerManager: null as any, // circular, fixed below
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
        const io = this.opts.adminServer.getIO();
        if (!io) return;
        io.to(`account:${accountId}`).emit('status:update', { accountId, status });
        io.to('account:all').emit('status:update', { accountId, status });
      },
      onWorkerLog: (entry, accountId, accountName) => {
        this.runtimeState.runtimeEvents.emit('worker_log', { entry, accountId, accountName });
        const io = this.opts.adminServer.getIO();
        if (!io) return;
        const id = String(entry?.accountId || accountId || '').trim();
        if (id) io.to(`account:${id}`).emit('log:new', entry);
        io.to('account:all').emit('log:new', entry);
      },
    });

    // Fix circular reference
    (this.reloginReminder as any).opts.workerManager = this.workerManager;

    this.panelDataProvider = new PanelDataProvider(
      this.workerManager,
      this.runtimeState,
      store,
      (targetAccountId = '') => this.broadcastConfigToWorkers(targetAccountId)
    );

    this.runtimeState.runtimeEvents.on('log', (entry: any) => {
      const io = this.opts.adminServer.getIO();
      if (!io) return;
      const id = String(entry?.accountId || '').trim();
      if (id) io.to(`account:${id}`).emit('log:new', entry);
      io.to('account:all').emit('log:new', entry);
    });

    this.runtimeState.runtimeEvents.on('account_log', (entry: any) => {
      const io = this.opts.adminServer.getIO();
      if (!io) return;
      const id = String(entry?.accountId || '').trim();
      if (id) io.to(`account:${id}`).emit('account-log:new', entry);
      io.to('account:all').emit('account-log:new', entry);
    });
  }

  async start(options: { startAdminServer?: boolean; autoStartAccounts?: boolean } = {}): Promise<void> {
    const shouldStartAdminServer = options.startAdminServer !== false;
    const shouldAutoStartAccounts = options.autoStartAccounts !== false;

    if (shouldStartAdminServer) {
      const { CONFIG } = require('../../config/config');
      const port = CONFIG?.adminPort || 3000;
      this.opts.adminServer.start(port);
    }

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
    const accounts = (store.getAccounts().accounts || []) as any[];
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
        worker.process.send({ type: 'config_sync', config });
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
}
