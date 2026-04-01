import { fork } from 'node:child_process';
import { Worker as WorkerThread } from 'node:worker_threads';
import process from 'node:process';
import type { IWorkerProcessManager } from '../../domain/ports/IWorkerProcessManager';
import type { IRuntimeStateService } from '../../domain/ports/IRuntimeStateService';
import { createScheduler } from '../../services/scheduler';

export interface WorkerProcessManagerOptions {
  runtimeMode?: string;
  mainEntryPath: string;
  workerScriptPath: string;
  runtimeState: IRuntimeStateService;
  getOfflineAutoDeleteMs: () => number;
  triggerOfflineReminder: (payload: any) => void;
  addOrUpdateAccount: (account: any) => any;
  deleteAccount: (id: string) => any;
  upsertFriendBlacklist: (accountId: string, gid: number) => boolean;
  broadcastConfigToWorkers: (accountId?: string) => void;
  onStatusSync?: (accountId: string, status: any, accountName: string) => void;
  onWorkerLog?: (entry: any, accountId: string, accountName: string) => void;
}

export class WorkerProcessManager implements IWorkerProcessManager {
  private readonly managerScheduler = createScheduler('worker_manager');
  private readonly useThreadRuntime: boolean;

  constructor(private readonly opts: WorkerProcessManagerOptions) {
    const runtimeMode = String(opts.runtimeMode || 'thread').toLowerCase();
    this.useThreadRuntime = runtimeMode === 'thread' && !(process as any).pkg && typeof WorkerThread === 'function';
  }

  startWorker(account: any): boolean {
    if (!account || !account.id) return false;
    const workers = this.opts.runtimeState.workers;
    if (workers[account.id]) return false;

    const { runtimeState } = this.opts;
    runtimeState.log('系统', `正在启动账号: ${account.name}`, { accountId: String(account.id), accountName: account.name });

    let child: any = null;
    try {
      child = this.createWorkerProcess(account);
    } catch (err: any) {
      const reason = err?.message || String(err || 'unknown error');
      runtimeState.log('错误', `账号 ${account.name} 启动失败: ${reason}`, { accountId: String(account.id), accountName: account.name });
      runtimeState.addAccountLog('start_failed', `账号 ${account.name} 启动失败`, account.id, account.name, { reason });
      return false;
    }

    const worker: any = {
      process: child,
      status: null,
      logs: [],
      requests: new Map(),
      reqId: 1,
      name: account.name,
      stopping: false,
      disconnectedSince: 0,
      autoDeleteTriggered: false,
      wsError: null,
    };
    workers[account.id] = worker;

    child.send({ type: 'start', config: { code: account.code, platform: account.platform } });
    child.send({ type: 'config_sync', config: this.opts.runtimeState.buildConfigSnapshotForAccount(account.id) });

    child.on('message', (msg: any) => this.handleWorkerMessage(account.id, msg));
    child.on('error', (err: any) => {
      runtimeState.log('系统', `账号 ${account.name} 子进程启动失败: ${err?.message || err}`, { accountId: String(account.id), accountName: account.name });
    });
    child.on('exit', (code: number | null, signal: string | null) => {
      const current = workers[account.id];
      const displayName = current?.name || account.name;
      runtimeState.log('系统', `账号 ${displayName} 进程退出 (code=${code}, signal=${signal || 'none'})`, {
        accountId: String(account.id),
        accountName: displayName,
        runtimeMode: this.useThreadRuntime ? 'thread' : 'fork',
      });

      this.managerScheduler.clear(`force_kill_${account.id}`);
      this.managerScheduler.clear(`restart_fallback_${account.id}`);

      if (current?.requests?.size > 0) {
        for (const [reqId, req] of current.requests.entries()) {
          this.managerScheduler.clear(`api_timeout_${account.id}_${reqId}`);
          try { req.reject(new Error('Worker exited')); } catch {}
        }
        current.requests.clear();
      }

      if (current && current.process === child) {
        delete workers[account.id];
      }
    });

    return true;
  }

  stopWorker(accountId: string): void {
    const workers = this.opts.runtimeState.workers;
    const worker = workers[accountId];
    if (!worker) return;

    const proc = worker.process;
    worker.stopping = true;
    proc.send({ type: 'stop' });
    this.managerScheduler.setTimeoutTask(`force_kill_${accountId}`, 1000, () => {
      const current = workers[accountId];
      if (current && current.process === proc) {
        current.process.kill?.();
        delete workers[accountId];
      }
    });
  }

  restartWorker(account: any): void {
    if (!account) return;
    const accountId = account.id;
    const workers = this.opts.runtimeState.workers;
    const worker = workers[accountId];
    if (!worker) {
      this.startWorker(account);
      return;
    }

    const proc = worker.process;
    let started = false;
    const startOnce = () => {
      if (started) return;
      started = true;
      this.managerScheduler.clear(`restart_fallback_${accountId}`);
      const current = workers[accountId];
      if (!current) {
        this.startWorker(account);
        return;
      }
      if (current.process !== proc) return;
      delete workers[accountId];
      this.startWorker(account);
    };

    const killIfStale = (): boolean => {
      const current = workers[accountId];
      if (!current || current.process !== proc) return false;
      try { current.process.kill?.(); } catch {}
      delete workers[accountId];
      return true;
    };

    if (typeof proc.exitCode === 'number' || proc.signalCode) {
      startOnce();
      return;
    }
    proc.once('exit', startOnce);
    this.stopWorker(accountId);
    this.managerScheduler.setTimeoutTask(`restart_fallback_${accountId}`, 1500, () => {
      if (started) return;
      killIfStale();
      startOnce();
    });
  }

  callWorkerApi(accountId: string, method: string, ...args: any[]): Promise<any> {
    const workers = this.opts.runtimeState.workers;
    const worker = workers[accountId];
    if (!worker) return Promise.reject(new Error('账号未运行'));

    return new Promise((resolve, reject) => {
      const id = worker.reqId++;
      worker.requests.set(id, { resolve, reject } as any);

      this.managerScheduler.setTimeoutTask(`api_timeout_${accountId}_${id}`, 10000, () => {
        if (worker.requests.has(id)) {
          worker.requests.delete(id);
          reject(new Error('API Timeout'));
        }
      });

      worker.process.send({ type: 'api_call', id, method, args });
    });
  }

  private createWorkerProcess(account: any): any {
    if (this.useThreadRuntime) {
      const worker = new WorkerThread(this.opts.workerScriptPath, {
        workerData: { accountId: String(account.id || ''), channel: 'thread' },
      });
      (worker as any).send = (payload: any) => worker.postMessage(payload);
      (worker as any).kill = () => worker.terminate();
      return worker;
    }

    if ((process as any).pkg) {
      return fork(this.opts.mainEntryPath, [], {
        execPath: process.execPath,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, FARM_WORKER: '1', FARM_ACCOUNT_ID: String(account.id || '') },
      });
    }

    return fork(this.opts.workerScriptPath, [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, FARM_ACCOUNT_ID: String(account.id || '') },
    });
  }

  private handleWorkerMessage(accountId: string, msg: any): void {
    const workers = this.opts.runtimeState.workers;
    const worker = workers[accountId];
    if (!worker) return;

    const { runtimeState } = this.opts;

    if (msg.type === 'status_sync') {
      worker.status = runtimeState.normalizeStatusForPanel(msg.data, accountId, worker.name);
      this.opts.onStatusSync?.(accountId, worker.status, worker.name);

      if (msg.data?.status?.name) {
        const newNick = String(msg.data.status.name).trim();
        if (newNick && newNick !== '未知' && newNick !== '未登录') {
          if (worker.nick !== newNick) {
            const oldNick = worker.nick;
            worker.nick = newNick;
            this.opts.addOrUpdateAccount({ id: accountId, nick: newNick });
            if (oldNick !== newNick) {
              runtimeState.log('系统', `已同步账号昵称: ${oldNick || 'None'} -> ${newNick}`, { accountId, accountName: worker.name });
            }
          }
        }
      }

      const connected = !!(msg.data?.connection?.connected);
      if (connected) {
        worker.disconnectedSince = 0;
        worker.autoDeleteTriggered = false;
        worker.wsError = null;
      } else if (!worker.stopping) {
        const now = Date.now();
        if (!worker.disconnectedSince) worker.disconnectedSince = now;
        const offlineMs = now - worker.disconnectedSince;
        const autoDeleteMs = this.opts.getOfflineAutoDeleteMs();
        if (!worker.autoDeleteTriggered && offlineMs >= autoDeleteMs) {
          worker.autoDeleteTriggered = true;
          const offlineMin = Math.floor(offlineMs / 60000);
          runtimeState.log('系统', `账号 ${worker.name} 持续离线 ${offlineMin} 分钟，自动删除账号信息`);
          this.opts.triggerOfflineReminder({ accountId, accountName: worker.name, reason: 'offline_timeout', offlineMs });
          runtimeState.addAccountLog('offline_delete', `账号 ${worker.name} 持续离线 ${offlineMin} 分钟，已自动删除`, accountId, worker.name, { reason: 'offline_timeout', offlineMs });
          this.stopWorker(accountId);
          try { this.opts.deleteAccount(accountId); } catch (e: any) {
            runtimeState.log('错误', `删除离线账号失败: ${e?.message || ''}`);
          }
        }
      }
    } else if (msg.type === 'log') {
      const logEntry: any = {
        ...msg.data,
        accountId,
        accountName: worker.name,
        ts: Date.now(),
        meta: msg.data?.meta || {},
      };
      logEntry._searchText = `${logEntry.msg || ''} ${logEntry.tag || ''} ${JSON.stringify(logEntry.meta || {})}`.toLowerCase();
      worker.logs.push(logEntry);
      if (worker.logs.length > 1000) worker.logs.shift();
      runtimeState.globalLogs.push(logEntry);
      if (runtimeState.globalLogs.length > 1000) runtimeState.globalLogs.shift();
      this.opts.onWorkerLog?.(logEntry, accountId, worker.name);
    } else if (msg.type === 'error') {
      runtimeState.log('错误', `账号[${accountId}]进程报错: ${msg.error}`, { accountId: String(accountId), accountName: worker.name });
    } else if (msg.type === 'ws_error') {
      const code = Number(msg.code) || 0;
      const message = String(msg.message || '');
      worker.wsError = { code, message, at: Date.now() };
      if (code === 400) {
        runtimeState.addAccountLog('ws_400', `账号 ${worker.name} 登录失效，请更新 Code`, accountId, worker.name);
      }
    } else if (msg.type === 'account_kicked') {
      const reason = String(msg.reason || '未知');
      runtimeState.log('系统', `账号 ${worker.name} 被踢下线，已自动停止账号`, { accountId: String(accountId), accountName: worker.name });
      this.opts.triggerOfflineReminder({ accountId, accountName: worker.name, reason: `kickout:${reason}`, offlineMs: 0 });
      runtimeState.addAccountLog('kickout_stop', `账号 ${worker.name} 被踢下线，已自动停止`, accountId, worker.name, { reason });
      this.stopWorker(accountId);
    } else if (msg.type === 'friend_blacklist_add') {
      const gid = Number(msg.gid);
      if (!Number.isFinite(gid) || gid <= 0) return;
      try {
        const changed = this.opts.upsertFriendBlacklist(accountId, gid);
        if (changed) this.opts.broadcastConfigToWorkers(accountId);
      } catch {}
    } else if (msg.type === 'api_response') {
      const { id, result, error } = msg;
      this.managerScheduler.clear(`api_timeout_${accountId}_${id}`);
      const req = worker.requests.get(id);
      if (req) {
        if (error) req.reject(new Error(error));
        else req.resolve(result);
        worker.requests.delete(id);
      }
    }
  }
}
