import EventEmitter from 'node:events';
import { createModuleLogger } from '../../services/logger';
import type {
  IRuntimeStateService,
  WorkerRecord,
  RuntimeLogEntry,
  AccountLogEntry,
} from '../../domain/ports/IRuntimeStateService';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatLocalDateTime24(date = new Date()): string {
  const d = date instanceof Date ? date : new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!bKeys.includes(key) || !deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function deepClone(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const cloned: any = {};
  for (const key of Object.keys(obj)) {
    cloned[key] = deepClone(obj[key]);
  }
  return cloned;
}

interface RuntimeStateOptions {
  store: any;
  operationKeys?: string[];
}

export class RuntimeStateService implements IRuntimeStateService {
  workers: Record<string, WorkerRecord> = {};
  globalLogs: RuntimeLogEntry[] = [];
  accountLogs: AccountLogEntry[] = [];
  accountLogsMap = new Map<string, AccountLogEntry[]>();
  runtimeEvents = new EventEmitter();

  private configRevision: number;
  private lastConfigSnapshot = new Map<string, any>();
  private readonly runtimeLogger = createModuleLogger('runtime');
  private readonly defaultOpsTemplate: Record<string, number>;
  private readonly opsPool: Array<Record<string, number>> = [];
  private readonly MAX_OPS_POOL_SIZE = 10;
  private readonly MAX_LOGS_PER_ACCOUNT = 500;

  private readonly operationKeys: string[];
  private readonly store: any;

  private readonly CONFIG_FIELDS = [
    'automation',
    'plantingStrategy',
    'preferredSeedId',
    'intervals',
    'friendBlockLevel',
    'friendQuietHours',
    'friendBlacklist',
    'friendCache',
    'runtimeClient',
  ];

  constructor(options: RuntimeStateOptions) {
    this.store = options.store;
    this.operationKeys = options.operationKeys || [];
    this.configRevision = Date.now();

    this.defaultOpsTemplate = {};
    for (const k of this.operationKeys) this.defaultOpsTemplate[k] = 0;
    Object.freeze(this.defaultOpsTemplate);
  }

  nextConfigRevision(): number {
    this.configRevision += 1;
    return this.configRevision;
  }

  buildConfigSnapshotForAccount(accountId: string): any {
    return {
      automation: this.store.getAutomation(accountId),
      plantingStrategy: this.store.getPlantingStrategy(accountId),
      preferredSeedId: this.store.getPreferredSeed(accountId),
      intervals: this.store.getIntervals(accountId),
      friendBlockLevel: this.store.getFriendBlockLevel(accountId),
      friendQuietHours: this.store.getFriendQuietHours(accountId),
      friendBlacklist: this.store.getFriendBlacklist(accountId),
      friendCache: this.store.getFriendCache(accountId),
      runtimeClient: this.store.getRuntimeClientConfig ? this.store.getRuntimeClientConfig() : null,
      __revision: this.configRevision,
    };
  }

  buildConfigDeltaForAccount(accountId: string): any | null {
    const accId = String(accountId || '').trim();
    const current = this.buildConfigSnapshotForAccount(accId);
    const last = this.lastConfigSnapshot.get(accId);

    if (!last) {
      this.lastConfigSnapshot.set(accId, deepClone(current));
      return current;
    }

    const delta: any = {
      __revision: current.__revision,
      __delta: true,
    };

    let hasChanges = false;
    for (const field of this.CONFIG_FIELDS) {
      if (!deepEqual(current[field], last[field])) {
        delta[field] = current[field];
        hasChanges = true;
      }
    }

    if (!hasChanges) return null;
    this.lastConfigSnapshot.set(accId, deepClone(current));
    return delta;
  }

  clearConfigSnapshot(accountId: string): void {
    const accId = String(accountId || '').trim();
    this.lastConfigSnapshot.delete(accId);
    this.accountLogsMap.delete(accId);
  }

  log(tag: string, msg: string, extra: any = {}): void {
    const time = formatLocalDateTime24(new Date());
    const level = tag === '错误' ? 'error' : 'info';
    this.runtimeLogger[level](msg, { tag, ...extra });
    const moduleName = tag === '系统' || tag === '错误' ? 'system' : '';
    const entry: RuntimeLogEntry = {
      time,
      tag,
      msg,
      meta: moduleName ? { module: moduleName } : {},
      ts: Date.now(),
      ...extra,
    };
    entry._searchText = `${entry.msg || ''} ${entry.tag || ''} ${JSON.stringify(entry.meta || {})}`.toLowerCase();

    this.globalLogs.push(entry);
    if (this.globalLogs.length > 1000) this.globalLogs.shift();

    const accountId = String(entry.accountId || '').trim();
    if (accountId) {
      if (!this.accountLogsMap.has(accountId)) {
        this.accountLogsMap.set(accountId, []);
      }
      const list = this.accountLogsMap.get(accountId)!;
      list.push(entry as any);
      if (list.length > this.MAX_LOGS_PER_ACCOUNT) list.shift();
    }

    this.runtimeEvents.emit('log', entry);
  }

  getLogsByAccount(accountId: string, filters: any = {}): RuntimeLogEntry[] {
    const accId = String(accountId || '').trim();
    if (!accId) return [];
    const list = this.accountLogsMap.get(accId);
    if (!list) return [];
    return this.filterLogs(list as any, filters);
  }

  addAccountLog(action: string, msg: string, accountId = '', accountName = '', extra: any = {}): void {
    const entry: AccountLogEntry = {
      time: formatLocalDateTime24(new Date()),
      action,
      msg,
      accountId: accountId ? String(accountId) : '',
      accountName: accountName || '',
      ...extra,
    };
    this.accountLogs.push(entry);
    if (this.accountLogs.length > 300) this.accountLogs.shift();
    this.runtimeEvents.emit('account_log', entry);
  }

  normalizeStatusForPanel(data: any, accountId: string, accountName: string): any {
    const src = data && typeof data === 'object' ? data : {};
    const srcOps = src.operations;

    if (srcOps && typeof srcOps === 'object') {
      let needsFix = false;
      for (const k of this.operationKeys) {
        const v = srcOps[k];
        if (v === undefined || v === null || Number.isNaN(Number(v))) {
          needsFix = true;
          break;
        }
      }
      if (!needsFix) {
        return {
          ...src,
          accountId,
          accountName,
          operations: srcOps,
        };
      }
    }

    let ops = this.opsPool.pop() || {};
    for (const k of this.operationKeys) ops[k] = 0;
    if (srcOps && typeof srcOps === 'object') {
      for (const k of this.operationKeys) {
        const v = srcOps[k];
        if (v !== undefined && v !== null && !Number.isNaN(Number(v))) {
          ops[k] = Number(v);
        }
      }
    }

    return {
      ...src,
      accountId,
      accountName,
      operations: ops,
    };
  }

  buildDefaultOperations(): Record<string, number> {
    return { ...this.defaultOpsTemplate };
  }

  buildDefaultStatus(accountId: string): any {
    return {
      connection: { connected: false },
      status: { name: '', level: 0, gold: 0, exp: 0, platform: 'qq' },
      uptime: 0,
      operations: this.buildDefaultOperations(),
      sessionExpGained: 0,
      sessionGoldGained: 0,
      sessionCouponGained: 0,
      lastExpGain: 0,
      lastGoldGain: 0,
      limits: {},
      wsError: null,
      automation: this.store.getAutomation(accountId),
      preferredSeed: this.store.getPreferredSeed(accountId),
      expProgress: { current: 0, needed: 0, level: 0 },
      configRevision: this.configRevision,
      accountId: String(accountId || ''),
    };
  }

  filterLogs(list: RuntimeLogEntry[], filters: any = {}): RuntimeLogEntry[] {
    const f = filters || {};
    const keyword = String(f.keyword || '').trim().toLowerCase();
    const keywordTerms = keyword ? keyword.split(/\s+/).filter(Boolean) : [];
    const tag = String(f.tag || '').trim();
    const moduleName = String(f.module || '').trim();
    const eventName = String(f.event || '').trim();
    const isWarn = f.isWarn;
    const timeFromMs = f.timeFrom ? Date.parse(String(f.timeFrom)) : Number.NaN;
    const timeToMs = f.timeTo ? Date.parse(String(f.timeTo)) : Number.NaN;

    return (list || []).filter((l) => {
      const logMs = Number(l && l.ts) || Date.parse(String((l && l.time) || ''));
      if (Number.isFinite(timeFromMs) && Number.isFinite(logMs) && logMs < timeFromMs) return false;
      if (Number.isFinite(timeToMs) && Number.isFinite(logMs) && logMs > timeToMs) return false;
      if (tag && String(l.tag || '') !== tag) return false;
      if (moduleName) {
        const logModule = String((l.meta || {}).module || '');
        if (moduleName === 'system') {
          const isSystemTag = String(l.tag || '') === '系统' || String(l.tag || '') === '错误';
          if (logModule !== 'system' && !isSystemTag) return false;
        } else if (logModule !== moduleName) {
          return false;
        }
      }
      if (eventName && String((l.meta || {}).event || '') !== eventName) return false;
      if (isWarn !== undefined && isWarn !== null && String(isWarn) !== '') {
        const expected = String(isWarn) === '1' || String(isWarn).toLowerCase() === 'true';
        if (!!l.isWarn !== expected) return false;
      }
      if (keywordTerms.length > 0) {
        const text = String(l._searchText || `${l.msg || ''} ${l.tag || ''}`).toLowerCase();
        for (const term of keywordTerms) {
          if (!text.includes(term)) return false;
        }
      }
      return true;
    });
  }
}
