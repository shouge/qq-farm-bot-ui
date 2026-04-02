import type { IPanelDataProvider } from '../../domain/ports/IPanelDataProvider';
import type { ILogRepository, LogQueryOptions, PaginatedLogs } from '../../domain/ports/ILogRepository';
import type { IWorkerProcessManager } from '../../domain/ports/IWorkerProcessManager';
import type { IRuntimeStateService } from '../../domain/ports/IRuntimeStateService';
import { findAccountByRef, normalizeAccountRef, resolveAccountId as resolveAccountIdByList } from '../../services/account-resolver';
import { getSchedulerRegistrySnapshot } from '../../services/scheduler';

/**
 * PanelDataProvider implements both IPanelDataProvider and ILogRepository
 * because log operations require account resolution (which needs store access)
 * and runtime state access (for actual log storage).
 * This is intentional fusion of two concerns at the infrastructure layer.
 */
export class PanelDataProvider implements IPanelDataProvider, ILogRepository {
  constructor(
    private readonly workerManager: IWorkerProcessManager,
    private readonly runtimeState: IRuntimeStateService,
    private readonly store: any,
    private readonly broadcastConfigFn: (accountId?: string) => void
  ) {}

  private getStoredAccountsList(): any[] {
    const data = this.store.getAccounts?.() || { accounts: [] };
    return Array.isArray(data.accounts) ? data.accounts : [];
  }

  private resolveAccountRefId(accountRef: string): string {
    const raw = normalizeAccountRef(accountRef);
    if (!raw) return '';
    const resolved = resolveAccountIdByList(this.getStoredAccountsList(), raw);
    return resolved || raw;
  }

  private findAccountByAnyRef(accountRef: string): any {
    return findAccountByRef(this.getStoredAccountsList(), accountRef);
  }

  resolveAccountId(accountRef: string): string {
    return this.resolveAccountRefId(accountRef);
  }

  getStatus(accountRef: string): any {
    const accountId = this.resolveAccountRefId(accountRef);
    if (!accountId) return this.runtimeState.buildDefaultStatus('');
    const w = this.runtimeState.workers[accountId];
    if (!w || !w.status) return this.runtimeState.buildDefaultStatus(accountId);
    return {
      ...this.runtimeState.buildDefaultStatus(accountId),
      ...w.status,
      wsError: w.wsError || null,
    };
  }

  getLogs(accountRef: string, optionsOrLimit: any = {}): any[] | PaginatedLogs {
    const opts = typeof optionsOrLimit === 'object' && optionsOrLimit ? optionsOrLimit : { limit: optionsOrLimit };
    const max = Math.max(1, Number(opts.limit) || 100);
    const rawRef = normalizeAccountRef(accountRef);
    const accountId = this.resolveAccountRefId(accountRef);

    let logsSource: any[];
    if (!rawRef) {
      logsSource = [...this.runtimeState.globalLogs];
    } else if (accountId) {
      logsSource = this.runtimeState.getLogsByAccount(accountId, opts);
    } else {
      if (!accountId) return { data: [], hasMore: false, nextCursor: null };
      logsSource = this.runtimeState.globalLogs.filter((l) => String(l.accountId || '') === String(accountId || ''));
    }

    const filteredLogs = rawRef ? logsSource : this.runtimeState.filterLogs(logsSource, opts);

    const before = opts.before ? Number(opts.before) : null;
    const after = opts.after ? Number(opts.after) : null;

    let result = filteredLogs;
    let hasMore = false;
    let nextCursor: number | null = null;

    if (before) {
      result = filteredLogs.filter((l) => {
        const ts = Number(l.ts) || Date.parse(String(l.time || ''));
        return ts < before;
      });
    } else if (after) {
      result = filteredLogs.filter((l) => {
        const ts = Number(l.ts) || Date.parse(String(l.time || ''));
        return ts > after;
      });
    }

    if (result.length > max) {
      hasMore = true;
      result = result.slice(-max);
      if (result.length > 0) {
        const firstEntry = result[0];
        nextCursor = Number(firstEntry.ts) || Date.parse(String(firstEntry.time || ''));
      }
    } else {
      result = result.slice(-max);
    }

    if (!before && !after && !opts.enablePagination) {
      return result;
    }
    return { data: result, hasMore, nextCursor };
  }

  clearLogs(accountRef: string): any {
    const accountId = this.resolveAccountRefId(accountRef);
    if (!accountId) throw new Error('Missing x-account-id');
    const accId = String(accountId || '');
    let cleared = 0;

    for (let i = this.runtimeState.globalLogs.length - 1; i >= 0; i -= 1) {
      if (String(this.runtimeState.globalLogs[i]?.accountId || '') !== accId) continue;
      this.runtimeState.globalLogs.splice(i, 1);
      cleared += 1;
    }

    if (this.runtimeState.accountLogsMap.has(accId)) {
      const list = this.runtimeState.accountLogsMap.get(accId)!;
      cleared += list.length;
      list.length = 0;
    }

    const worker = this.runtimeState.workers[accId];
    if (worker && Array.isArray(worker.logs)) {
      worker.logs.length = 0;
    }

    return { accountId: accId, cleared };
  }

  getAccountLogs(limit?: number): any[] {
    return this.runtimeState.accountLogs.slice(-(limit || 100)).reverse();
  }

  addAccountLog(action: string, msg: string, accountId?: string, accountName?: string, extra?: any): void {
    this.runtimeState.addAccountLog(action, msg, accountId, accountName, extra);
  }

  getLands(accountRef: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'getLands');
  }

  getFriends(accountRef: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'getFriends');
  }

  getInteractRecords(accountRef: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'getInteractRecords');
  }

  getFriendLands(accountRef: string, gid: number): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'getFriendLands', gid);
  }

  doFriendOp(accountRef: string, gid: number, opType: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'doFriendOp', gid, opType);
  }

  getFriendBlacklist(accountRef: string): Promise<number[]> {
    const accountId = this.resolveAccountRefId(accountRef);
    if (!accountId) return Promise.resolve([]);
    const fromStore = this.store.getFriendBlacklist ? this.store.getFriendBlacklist(accountId) : [];
    return Promise.resolve(Array.isArray(fromStore) ? fromStore : []);
  }

  setFriendBlacklist(accountRef: string, list: number[]): void {
    const accountId = this.resolveAccountRefId(accountRef);
    if (this.store.setFriendBlacklist) {
      this.store.setFriendBlacklist(accountId, list);
    }
  }

  getFriendCache(accountRef: string): Promise<any[]> {
    const accountId = this.resolveAccountRefId(accountRef);
    if (!accountId) return Promise.resolve([]);
    const fromStore = this.store.getFriendCache ? this.store.getFriendCache(accountId) : [];
    return Promise.resolve(Array.isArray(fromStore) ? fromStore : []);
  }

  updateFriendCache(accountRef: string, friends: any[]): Promise<any[]> {
    const accountId = this.resolveAccountRefId(accountRef);
    if (this.store.updateFriendCache) {
      return Promise.resolve(this.store.updateFriendCache(accountId, friends));
    }
    return Promise.resolve(friends);
  }

  setFriendCache(accountRef: string, list: any[]): Promise<any[]> {
    const accountId = this.resolveAccountRefId(accountRef);
    if (this.store.setFriendCache) {
      return Promise.resolve(this.store.setFriendCache(accountId, list));
    }
    return Promise.resolve(list);
  }

  extractFriendsFromInteractRecords(accountRef: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'extractFriendsFromInteractRecords');
  }

  getBag(accountRef: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'getBag');
  }

  getBagSeeds(accountRef: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'getBagSeeds');
  }

  getDailyGifts(accountRef: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'getDailyGiftOverview');
  }

  getSeeds(accountRef: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'getSeeds');
  }

  doFarmOp(accountRef: string, opType: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'doFarmOp', opType);
  }

  doSingleLandOp(accountRef: string, payload: any): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'doSingleLandOp', payload);
  }

  doAnalytics(accountRef: string, sortBy: string): Promise<any> {
    return this.workerManager.callWorkerApi(this.resolveAccountRefId(accountRef), 'doAnalytics', sortBy);
  }

  getSchedulerStatus(accountRef: string): Promise<any> {
    const accountId = this.resolveAccountRefId(accountRef);
    const runtime = getSchedulerRegistrySnapshot();
    let worker: any = null;
    let workerError = '';

    if (!accountId) {
      return Promise.resolve({ accountId: '', runtime, worker, workerError });
    }

    if (!this.runtimeState.workers[accountId]) {
      return Promise.resolve({ accountId, runtime, worker, workerError: '账号未运行' });
    }

    return this.workerManager.callWorkerApi(accountId, 'getSchedulers')
      .then((data) => ({ accountId, runtime, worker: data, workerError: '' }))
      .catch((e: any) => ({ accountId, runtime, worker, workerError: e?.message || String(e || 'unknown') }));
  }

  saveSettings(accountRef: string, payload: any): Promise<any> {
    const accountId = this.resolveAccountRefId(accountRef);
    if (!accountId) throw new Error('Missing x-account-id');
    const body = payload && typeof payload === 'object' ? payload : {};
    const plantingStrategy = body.plantingStrategy !== undefined ? body.plantingStrategy : body.strategy;
    const preferredSeedId = body.preferredSeedId !== undefined ? body.preferredSeedId : body.seedId;
    const bagSeedPriority = body.bagSeedPriority;
    const snapshot = {
      plantingStrategy,
      preferredSeedId,
      bagSeedPriority,
      intervals: body.intervals,
      friendBlockLevel: body.friendBlockLevel,
      friendQuietHours: body.friendQuietHours,
    };
    this.store.applyConfigSnapshot(snapshot, { accountId });
    const rev = this.runtimeState.nextConfigRevision();
    this.broadcastConfigFn(accountId);
    return Promise.resolve({
      strategy: this.store.getPlantingStrategy(accountId),
      preferredSeed: this.store.getPreferredSeed(accountId),
      bagSeedPriority: this.store.getBagSeedPriority ? this.store.getBagSeedPriority(accountId) : null,
      intervals: this.store.getIntervals(accountId),
      friendBlockLevel: this.store.getFriendBlockLevel(accountId),
      friendQuietHours: this.store.getFriendQuietHours(accountId),
      configRevision: rev,
    });
  }

  setAutomation(accountRef: string, key: string, value: unknown): Promise<any> {
    const accountId = this.resolveAccountRefId(accountRef);
    if (!accountId) throw new Error('Missing x-account-id');
    this.store.setAutomation(key, value, accountId);
    const rev = this.runtimeState.nextConfigRevision();
    this.broadcastConfigFn(accountId);
    return Promise.resolve({ automation: this.store.getAutomation(accountId), configRevision: rev });
  }

  setUITheme(theme: string): Promise<any> {
    const snapshot = this.store.setUITheme(theme);
    return Promise.resolve({ ui: snapshot?.ui || this.store.getUI() });
  }

  getRuntimeClientConfig(): any {
    return this.store.getRuntimeClientConfig ? this.store.getRuntimeClientConfig() : null;
  }

  setRuntimeClientConfig(payload: any): Promise<any> {
    const body = payload && typeof payload === 'object' ? payload : {};
    if (this.store.setRuntimeClientConfig) {
      this.store.setRuntimeClientConfig(body);
    }
    const rev = this.runtimeState.nextConfigRevision();
    this.broadcastConfigFn('');
    return Promise.resolve({ runtimeClient: this.store.getRuntimeClientConfig ? this.store.getRuntimeClientConfig() : null, configRevision: rev });
  }

  broadcastConfig(accountId?: string): void {
    this.broadcastConfigFn(accountId);
  }

  getAccounts(): { accounts: any[] } {
    const data = this.store.getAccounts ? this.store.getAccounts() : { accounts: [] };
    data.accounts.forEach((a: any) => {
      const worker = this.runtimeState.workers[a.id];
      a.running = !!worker;
      if (worker?.status?.status?.name) {
        a.nick = worker.status.status.name;
      }
    });
    return data;
  }

  startAccount(accountRef: string): boolean {
    const accountId = this.resolveAccountRefId(accountRef);
    const acc = this.findAccountByAnyRef(accountId || accountRef);
    if (!acc) return false;
    this.workerManager.startWorker(acc);
    return true;
  }

  stopAccount(accountRef: string): boolean {
    const accountId = this.resolveAccountRefId(accountRef);
    const acc = this.findAccountByAnyRef(accountId || accountRef);
    if (!acc) return false;
    if (accountId) this.workerManager.stopWorker(accountId);
    return true;
  }

  restartAccount(accountRef: string): boolean {
    const accountId = this.resolveAccountRefId(accountRef);
    const acc = this.findAccountByAnyRef(accountId || accountRef);
    if (!acc) return false;
    this.workerManager.restartWorker(acc);
    return true;
  }

  isAccountRunning(accountRef: string): boolean {
    const accountId = this.resolveAccountRefId(accountRef);
    return !!(accountId && this.runtimeState.workers[accountId]);
  }

  setRuntimeAccountName(accountRef: string, accountName: string): void {
    const accountId = this.resolveAccountRefId(accountRef);
    if (!accountId) return;
    const worker = this.runtimeState.workers[accountId];
    if (worker) {
      worker.name = String(accountName || worker.name || accountId);
    }
  }
}
