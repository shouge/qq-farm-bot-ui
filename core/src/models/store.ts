/**
 * 运行时存储 - 自动化开关、种子偏好、账号管理
 */

import process from 'node:process';
import { getDataFile, ensureDataDir } from '../config/runtime-paths';
import { CONFIG as BASE_CONFIG } from '../config/config';
import { readTextFile, readJsonFile, writeJsonFileAtomic } from '../services/json-db';
import {
  validateAccountConfig,
  validateOfflineReminder,
  validateQrLoginConfig,
  validateRuntimeClientConfig,
  validateFriendCache,
  ALLOWED_VALUES,
  type FriendCacheItem,
} from '../utils/config-schema';

/** 自动化配置 */
export interface AutomationConfig extends Record<string, unknown> {
  farm?: boolean;
  farm_manage?: boolean;
  farm_water?: boolean;
  farm_weed?: boolean;
  farm_bug?: boolean;
  farm_push?: boolean;
  land_upgrade?: boolean;
  friend?: boolean;
  friend_help_exp_limit?: boolean;
  friend_steal?: boolean;
  friend_steal_blacklist?: number[];
  friend_help?: boolean;
  friend_bad?: boolean;
  task?: boolean;
  email?: boolean;
  fertilizer_gift?: boolean;
  fertilizer_buy?: boolean;
  fertilizer_buy_type?: string;
  fertilizer_buy_max?: number;
  fertilizer_buy_mode?: string;
  fertilizer_buy_threshold?: number;
  free_gifts?: boolean;
  share_reward?: boolean;
  vip_gift?: boolean;
  month_card?: boolean;
  open_server_gift?: boolean;
  sell?: boolean;
  fertilizer?: string;
  fertilizer_multi_season?: boolean;
  fertilizer_land_types?: string[];
}

/** 间隔配置 */
export interface IntervalsConfig extends Record<string, number> {
  farm: number;
  friend: number;
  farmMin: number;
  farmMax: number;
  friendMin: number;
  friendMax: number;
}

/** 好友等级限制配置 */
export interface FriendBlockLevelConfig {
  enabled: boolean;
  Level: number;
}

/** 好友静默时段配置 */
export interface FriendQuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
}

// 批量写入配置
const SAVE_DEBOUNCE_MS = 500; // 500ms内多次变更合并为一次写入
let saveTimer: NodeJS.Timeout | null = null;
let pendingSave = false;

const STORE_FILE = getDataFile('store.json');
const ACCOUNTS_FILE = getDataFile('accounts.json');
const DEFAULT_OFFLINE_DELETE_SEC = 1;

/** 下线提醒配置 */
export interface OfflineReminderConfig {
  channel: 'webhook';
  reloginUrlMode: 'none' | 'custom' | 'same';
  endpoint: string;
  token: string;
  title: string;
  msg: string;
  offlineDeleteSec: number;
  offlineDeleteEnabled: boolean;
  custom_headers: string;
  custom_body: string;
}

const DEFAULT_OFFLINE_REMINDER: OfflineReminderConfig = {
  channel: 'webhook',
  reloginUrlMode: 'none',
  endpoint: '',
  token: '',
  title: '账号下线提醒',
  msg: '账号下线',
  offlineDeleteSec: DEFAULT_OFFLINE_DELETE_SEC,
  offlineDeleteEnabled: false,
  custom_headers: '',
  custom_body: '',
};

/** QR登录配置 */
export interface QrLoginConfig {
  apiDomain: string;
}

const DEFAULT_QR_LOGIN: QrLoginConfig = {
  apiDomain: 'q.qq.com',
};

/** 运行时客户端配置 */
export interface RuntimeClientConfig {
  serverUrl: string;
  clientVersion: string;
  os: string;
  device_info: {
    sys_software: string;
    network: string;
    memory: string;
    device_id: string;
    client_version?: string;
  };
}

const DEFAULT_RUNTIME_CLIENT: RuntimeClientConfig = {
  serverUrl: BASE_CONFIG.serverUrl,
  clientVersion: BASE_CONFIG.clientVersion,
  os: BASE_CONFIG.os,
  device_info: {
    sys_software: BASE_CONFIG.device_info?.sys_software ?? 'iOS 26.2.1',
    network: BASE_CONFIG.device_info?.network ?? 'wifi',
    memory: BASE_CONFIG.device_info?.memory ?? '7672',
    device_id: BASE_CONFIG.device_info?.device_id ?? 'iPhone X<iPhone18,3>',
  },
};

// ============ LRU 缓存实现 ============

/** LRU缓存条目 */
interface CacheEntry<T> {
  key: string | number;
  value: T;
}

/** LRU缓存类 */
export class LRUCache<T> {
  private maxSize: number;
  private cache: Map<string | number, T>;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key: string | number): T | undefined {
    if (!this.cache.has(key)) return undefined;
    // 移动到末尾（最近访问）
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: string | number, value: T): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 淘汰最久未访问的（第一个）
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: string | number): boolean {
    return this.cache.has(key);
  }

  delete(key: string | number): boolean {
    return this.cache.delete(key);
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  // 获取所有值（按访问顺序）
  values(): T[] {
    return Array.from(this.cache.values());
  }

  // 批量设置（保留访问顺序）
  setAll(entries: Array<{ gid: string | number } & Record<string, unknown>>): void {
    this.cache.clear();
    for (const entry of entries) {
      if (entry && entry.gid) {
        this.cache.set(entry.gid, entry as unknown as T);
      }
    }
  }
}

// 好友 LRU 缓存实例（限制 500 个）
const friendLRUCache = new LRUCache<FriendCacheItem>(500);

/** 账号自动化配置 */
export interface AccountConfig {
  automation: AutomationConfig;
  plantingStrategy: string;
  preferredSeedId: number;
  bagSeedPriority: number[];
  intervals: IntervalsConfig;
  friendBlockLevel: FriendBlockLevelConfig;
  friendQuietHours: FriendQuietHoursConfig;
  friendBlacklist: number[];
  friendCache: FriendCacheItem[];
}

const DEFAULT_ACCOUNT_CONFIG: AccountConfig = {
  automation: {
    farm: true,
    farm_manage: true,
    farm_water: true,
    farm_weed: true,
    farm_bug: true,
    farm_push: true,
    land_upgrade: true,
    friend: true,
    friend_help_exp_limit: true,
    friend_steal: true,
    friend_steal_blacklist: [],
    friend_help: true,
    friend_bad: false,
    task: true,
    email: true,
    fertilizer_gift: false,
    fertilizer_buy: false,
    fertilizer_buy_type: 'organic',
    fertilizer_buy_max: 10,
    fertilizer_buy_mode: 'threshold',
    fertilizer_buy_threshold: 100,
    free_gifts: true,
    share_reward: true,
    vip_gift: true,
    month_card: true,
    open_server_gift: true,
    sell: false,
    fertilizer: 'none',
    fertilizer_multi_season: false,
    fertilizer_land_types: ['gold', 'black', 'red', 'normal'],
  },
  plantingStrategy: 'preferred',
  preferredSeedId: 0,
  bagSeedPriority: [],
  intervals: {
    farm: 2,
    friend: 10,
    farmMin: 2,
    farmMax: 2,
    friendMin: 10,
    friendMax: 10,
  },
  friendBlockLevel: {
    enabled: true,
    Level: 1,
  },
  friendQuietHours: {
    enabled: false,
    start: '23:00',
    end: '07:00',
  },
  friendBlacklist: [],
  friendCache: [],
};

let accountFallbackConfig: AccountConfig = {
  ...DEFAULT_ACCOUNT_CONFIG,
  automation: {
    ...DEFAULT_ACCOUNT_CONFIG.automation,
    fertilizer_land_types: ['gold', 'black', 'red', 'normal'],
    friend_steal_blacklist: [],
  },
  intervals: { ...DEFAULT_ACCOUNT_CONFIG.intervals },
  friendBlockLevel: { ...DEFAULT_ACCOUNT_CONFIG.friendBlockLevel },
  friendQuietHours: { ...DEFAULT_ACCOUNT_CONFIG.friendQuietHours },
};

/** UI配置 */
export interface UIConfig {
  theme: 'dark' | 'light';
}

/** 全局配置 */
export interface GlobalConfig {
  accountConfigs: Record<string, AccountConfig>;
  defaultAccountConfig: AccountConfig;
  ui: UIConfig;
  offlineReminder: OfflineReminderConfig;
  qrLogin: QrLoginConfig;
  runtimeClient: RuntimeClientConfig;
  adminPasswordHash: string;
  disablePasswordAuth: boolean;
}

const globalConfig: GlobalConfig = {
  accountConfigs: {},
  defaultAccountConfig: cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG),
  ui: {
    theme: 'dark',
  },
  offlineReminder: { ...DEFAULT_OFFLINE_REMINDER },
  qrLogin: { ...DEFAULT_QR_LOGIN },
  runtimeClient: {
    ...DEFAULT_RUNTIME_CLIENT,
    device_info: { ...DEFAULT_RUNTIME_CLIENT.device_info },
  },
  adminPasswordHash: '',
  disablePasswordAuth: false,
};

function normalizeOfflineReminder(input: unknown): OfflineReminderConfig {
  const result = validateOfflineReminder(input);
  return result as unknown as OfflineReminderConfig;
}

function normalizeQrLoginConfig(input: unknown): QrLoginConfig {
  const result = validateQrLoginConfig(input);
  return result as unknown as QrLoginConfig;
}

function normalizeRuntimeClientConfig(
  input: unknown,
  fallback: RuntimeClientConfig | null = null
): RuntimeClientConfig {
  const base =
    fallback || {
      serverUrl: BASE_CONFIG.serverUrl,
      clientVersion: BASE_CONFIG.clientVersion,
      os: BASE_CONFIG.os,
      device_info: BASE_CONFIG.device_info || {},
    };
  const result = validateRuntimeClientConfig(input, base as unknown as Record<string, unknown>);
  return result as unknown as RuntimeClientConfig;
}

export function getRuntimeClientConfig(): RuntimeClientConfig {
  const current = globalConfig.runtimeClient;
  const base = {
    serverUrl: BASE_CONFIG.serverUrl,
    clientVersion: BASE_CONFIG.clientVersion,
    os: BASE_CONFIG.os,
    device_info: BASE_CONFIG.device_info || {},
  };
  const validated = validateRuntimeClientConfig(current, base as unknown as Record<string, unknown>);
  // device_info.client_version 永远由 clientVersion 派生
  return {
    ...validated,
    device_info: {
      ...validated.device_info,
      client_version: validated.clientVersion,
    },
  };
}

export function setRuntimeClientConfig(cfg: Partial<RuntimeClientConfig>): RuntimeClientConfig {
  const current = getRuntimeClientConfig();
  const merged: RuntimeClientConfig = {
    ...current,
    ...cfg,
    device_info: {
      ...(current.device_info || {}),
      ...(cfg?.device_info || {}),
    },
  };
  const validated = normalizeRuntimeClientConfig(merged, {
    serverUrl: BASE_CONFIG.serverUrl,
    clientVersion: BASE_CONFIG.clientVersion,
    os: BASE_CONFIG.os,
    device_info: BASE_CONFIG.device_info || {},
  });
  globalConfig.runtimeClient = {
    ...validated,
    device_info: { ...validated.device_info },
  };
  saveGlobalConfig();
  return getRuntimeClientConfig();
}

function normalizeFriendCache(input: unknown): FriendCacheItem[] {
  return validateFriendCache(input);
}

function cloneAccountConfig(base: AccountConfig = DEFAULT_ACCOUNT_CONFIG): AccountConfig {
  const result = validateAccountConfig(base, DEFAULT_ACCOUNT_CONFIG as unknown as Record<string, unknown>);
  return result as unknown as AccountConfig;
}

export function resolveAccountId(accountId?: string | null): string {
  const direct = accountId !== undefined && accountId !== null ? String(accountId).trim() : '';
  if (direct) return direct;
  const envId = String(process.env.FARM_ACCOUNT_ID || '').trim();
  return envId;
}

function normalizeAccountConfig(
  input: unknown,
  fallback: AccountConfig = accountFallbackConfig
): AccountConfig {
  const result = validateAccountConfig(input, fallback as unknown as Record<string, unknown>);
  return result as unknown as AccountConfig;
}

function getAccountConfigSnapshot(accountId?: string | null): AccountConfig {
  const id = resolveAccountId(accountId);
  if (!id) return cloneAccountConfig(accountFallbackConfig);
  return normalizeAccountConfig(globalConfig.accountConfigs[id], accountFallbackConfig);
}

function setAccountConfigSnapshot(
  accountId: string | null | undefined,
  nextConfig: AccountConfig,
  persist = true
): AccountConfig {
  const id = resolveAccountId(accountId);
  if (!id) {
    accountFallbackConfig = normalizeAccountConfig(nextConfig, accountFallbackConfig);
    globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
    if (persist) saveGlobalConfig();
    return cloneAccountConfig(accountFallbackConfig);
  }
  globalConfig.accountConfigs[id] = normalizeAccountConfig(nextConfig, accountFallbackConfig);
  if (persist) saveGlobalConfig();
  return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

function removeAccountConfig(accountId: string | null | undefined): void {
  const id = resolveAccountId(accountId);
  if (!id) return;
  if (globalConfig.accountConfigs[id]) {
    delete globalConfig.accountConfigs[id];
    saveGlobalConfig();
  }
}

function ensureAccountConfig(
  accountId: string | null | undefined,
  options: { persist?: boolean } = {}
): AccountConfig | null {
  const id = resolveAccountId(accountId);
  if (!id) return null;
  if (globalConfig.accountConfigs[id]) {
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
  }
  globalConfig.accountConfigs[id] = normalizeAccountConfig(
    globalConfig.defaultAccountConfig,
    accountFallbackConfig
  );
  // 新账号默认不施肥（不受历史 defaultAccountConfig 旧值影响）
  if (globalConfig.accountConfigs[id]?.automation) {
    globalConfig.accountConfigs[id].automation.fertilizer = 'none';
  }
  if (options.persist !== false) saveGlobalConfig();
  return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

// 加载全局配置
function loadGlobalConfig(): void {
  ensureDataDir();
  try {
    const data = readJsonFile<Partial<GlobalConfig>>(STORE_FILE, () => ({}));
    if (data && typeof data === 'object') {
      if (data.defaultAccountConfig && typeof data.defaultAccountConfig === 'object') {
        accountFallbackConfig = normalizeAccountConfig(
          data.defaultAccountConfig,
          DEFAULT_ACCOUNT_CONFIG
        );
      } else {
        accountFallbackConfig = cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG);
      }
      globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

      const cfgMap =
        data.accountConfigs && typeof data.accountConfigs === 'object'
          ? data.accountConfigs
          : {};
      globalConfig.accountConfigs = {};
      for (const [id, cfg] of Object.entries(cfgMap)) {
        const sid = String(id || '').trim();
        if (!sid) continue;
        globalConfig.accountConfigs[sid] = normalizeAccountConfig(cfg, accountFallbackConfig);
      }
      // 统一规范化，确保内存中不残留旧字段
      globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
      for (const id of Object.keys(globalConfig.accountConfigs)) {
        globalConfig.accountConfigs[id] = normalizeAccountConfig(
          globalConfig.accountConfigs[id],
          accountFallbackConfig
        );
      }
      globalConfig.ui = { ...globalConfig.ui, ...(data.ui || {}) };
      const theme = String(globalConfig.ui.theme || '').toLowerCase();
      globalConfig.ui.theme = theme === 'light' ? 'light' : 'dark';
      globalConfig.offlineReminder = normalizeOfflineReminder(data.offlineReminder);
      globalConfig.qrLogin = normalizeQrLoginConfig(data.qrLogin);
      if (data.runtimeClient && typeof data.runtimeClient === 'object') {
        const normalized = normalizeRuntimeClientConfig(data.runtimeClient);
        globalConfig.runtimeClient = {
          ...normalized,
          device_info: { ...(normalized.device_info || {}) },
        };
      } else {
        globalConfig.runtimeClient = {
          ...DEFAULT_RUNTIME_CLIENT,
          device_info: { ...DEFAULT_RUNTIME_CLIENT.device_info },
        };
      }
      if (typeof data.adminPasswordHash === 'string') {
        globalConfig.adminPasswordHash = data.adminPasswordHash;
      }
      if (typeof data.disablePasswordAuth === 'boolean') {
        globalConfig.disablePasswordAuth = data.disablePasswordAuth;
      }
    }
  } catch (e) {
    console.error('加载配置失败:', (e as Error).message);
  }
}

function sanitizeGlobalConfigBeforeSave(): void {
  // default 配置统一白名单净化
  accountFallbackConfig = normalizeAccountConfig(
    globalConfig.defaultAccountConfig,
    DEFAULT_ACCOUNT_CONFIG
  );
  globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

  // 每个账号配置也统一净化
  const map =
    globalConfig.accountConfigs && typeof globalConfig.accountConfigs === 'object'
      ? globalConfig.accountConfigs
      : {};
  const nextMap: Record<string, AccountConfig> = {};
  for (const [id, cfg] of Object.entries(map)) {
    const sid = String(id || '').trim();
    if (!sid) continue;
    nextMap[sid] = normalizeAccountConfig(cfg, accountFallbackConfig);
  }
  globalConfig.accountConfigs = nextMap;

  // runtimeClient 白名单净化
  const runtimeConfig = getRuntimeClientConfig();
  globalConfig.runtimeClient = {
    ...runtimeConfig,
    device_info: { ...runtimeConfig.device_info },
  };
}

// 立即同步保存（用于进程退出时）
function flushGlobalConfigSync(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pendingSave) return;
  pendingSave = false;

  ensureDataDir();
  try {
    sanitizeGlobalConfigBeforeSave();
    writeJsonFileAtomic(STORE_FILE, globalConfig);
    console.warn('[系统] 配置已同步保存');
  } catch (e) {
    console.error('同步保存配置失败:', (e as Error).message);
  }
}

// 保存全局配置（批量写入优化）
function saveGlobalConfig(): void {
  pendingSave = true;

  if (saveTimer) {
    return; // 已在等待写入，新变更会合并
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!pendingSave) return;
    pendingSave = false;

    ensureDataDir();
    try {
      const oldJson = readTextFile(STORE_FILE, '');

      sanitizeGlobalConfigBeforeSave();
      const newJson = JSON.stringify(globalConfig, null, 2);

      if (oldJson !== newJson) {
        console.warn('[系统] 正在保存配置到:', STORE_FILE);
        writeJsonFileAtomic(STORE_FILE, globalConfig);
      }
    } catch (e) {
      console.error('保存配置失败:', (e as Error).message);
    }
  }, SAVE_DEBOUNCE_MS);
}

// 进程退出时同步刷新配置
process.on('exit', flushGlobalConfigSync);
process.on('SIGINT', () => {
  flushGlobalConfigSync();
  process.exit(0);
});
process.on('SIGTERM', () => {
  flushGlobalConfigSync();
  process.exit(0);
});

export function getAdminPasswordHash(): string {
  return String(globalConfig.adminPasswordHash || '');
}

export function setAdminPasswordHash(hash: string): string {
  globalConfig.adminPasswordHash = String(hash || '');
  saveGlobalConfig();
  return globalConfig.adminPasswordHash;
}

export function getDisablePasswordAuth(): boolean {
  return Boolean(globalConfig.disablePasswordAuth);
}

export function setDisablePasswordAuth(disabled: boolean): boolean {
  globalConfig.disablePasswordAuth = Boolean(disabled);
  saveGlobalConfig();
  return globalConfig.disablePasswordAuth;
}

// 初始化加载
loadGlobalConfig();

export function getAutomation(accountId?: string | null): AutomationConfig {
  const { validateAutomation } = require('../utils/config-schema');
  const automation = getAccountConfigSnapshot(accountId).automation;
  return validateAutomation(automation);
}

/** 配置快照 */
export interface ConfigSnapshot {
  automation: AutomationConfig;
  plantingStrategy: string;
  preferredSeedId: number;
  intervals: IntervalsConfig;
  friendBlockLevel: FriendBlockLevelConfig;
  friendQuietHours: FriendQuietHoursConfig;
  friendBlacklist: number[];
  ui: UIConfig;
  qrLogin: QrLoginConfig;
  runtimeClient: RuntimeClientConfig;
}

export function getConfigSnapshot(accountId?: string | null): ConfigSnapshot {
  const cfg = getAccountConfigSnapshot(accountId);
  return {
    automation: { ...cfg.automation },
    plantingStrategy: cfg.plantingStrategy,
    preferredSeedId: cfg.preferredSeedId,
    intervals: { ...cfg.intervals },
    friendBlockLevel: { ...cfg.friendBlockLevel },
    friendQuietHours: { ...cfg.friendQuietHours },
    friendBlacklist: [...(cfg.friendBlacklist || [])],
    ui: { ...globalConfig.ui },
    qrLogin: normalizeQrLoginConfig(globalConfig.qrLogin),
    runtimeClient: getRuntimeClientConfig(),
  };
}

/** 应用配置选项 */
export interface ApplyConfigOptions {
  persist?: boolean;
  accountId?: string | null;
}

export function applyConfigSnapshot(
  snapshot: Partial<ConfigSnapshot>,
  options: ApplyConfigOptions = {}
): ConfigSnapshot {
  const cfg = snapshot || {};
  const persist = options.persist !== false;
  const accountId = options.accountId;

  const current = getAccountConfigSnapshot(accountId);
  const next = validateAccountConfig(cfg, current);

  if (cfg.ui && typeof cfg.ui === 'object') {
    const theme = String(cfg.ui.theme || '').toLowerCase();
    if (theme === 'dark' || theme === 'light') {
      globalConfig.ui.theme = theme as 'dark' | 'light';
    }
  }

  setAccountConfigSnapshot(accountId, next, false);
  if (persist) saveGlobalConfig();
  return getConfigSnapshot(accountId);
}

export function setAutomation(
  key: string,
  value: unknown,
  accountId?: string | null
): ConfigSnapshot {
  return applyConfigSnapshot({ automation: { [key]: value } as Partial<AutomationConfig> }, {
    accountId,
  });
}

export function isAutomationOn(key: string, accountId?: string | null): boolean {
  return !!getAccountConfigSnapshot(accountId).automation[key as keyof AutomationConfig];
}

export function getPreferredSeed(accountId?: string | null): number {
  return getAccountConfigSnapshot(accountId).preferredSeedId;
}

export function getPlantingStrategy(accountId?: string | null): string {
  return getAccountConfigSnapshot(accountId).plantingStrategy;
}

export function getBagSeedPriority(accountId?: string | null): number[] {
  return [...(getAccountConfigSnapshot(accountId).bagSeedPriority || [])];
}

export function setPlantingStrategy(accountId: string | null | undefined, strategy: string): boolean {
  if (!ALLOWED_VALUES.plantingStrategy.has(strategy)) return false;
  applyConfigSnapshot({ plantingStrategy: strategy }, { accountId });
  return true;
}

export function getIntervals(accountId?: string | null): IntervalsConfig {
  return { ...getAccountConfigSnapshot(accountId).intervals };
}

export function getFriendBlockLevel(accountId?: string | null): FriendBlockLevelConfig {
  return { ...getAccountConfigSnapshot(accountId).friendBlockLevel };
}

export function getFriendQuietHours(accountId?: string | null): FriendQuietHoursConfig {
  return { ...getAccountConfigSnapshot(accountId).friendQuietHours };
}

export function getFriendBlacklist(accountId?: string | null): number[] {
  return [...(getAccountConfigSnapshot(accountId).friendBlacklist || [])];
}

export function setFriendBlacklist(
  accountId: string | null | undefined,
  list: number[]
): number[] {
  const current = getAccountConfigSnapshot(accountId);
  const next = normalizeAccountConfig(current, accountFallbackConfig);
  next.friendBlacklist = Array.isArray(list)
    ? list.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  setAccountConfigSnapshot(accountId, next);
  return [...next.friendBlacklist];
}

export function getFriendCache(accountId?: string | null): FriendCacheItem[] {
  const id = resolveAccountId(accountId);
  if (!id) return [];

  // 从配置中加载到 LRU 缓存（如果缓存为空）
  if (friendLRUCache.size() === 0) {
    const cfg = getAccountConfigSnapshot(id);
    const friends = normalizeFriendCache(cfg.friendCache);
    for (const f of friends) {
      friendLRUCache.set(f.gid, f);
    }
  }

  // 标记访问时间并返回
  const friends = friendLRUCache.values();
  const now = Date.now();
  for (const f of friends) {
    f.lastAccessed = now;
  }
  return friends;
}

export function setFriendCache(
  accountId: string | null | undefined,
  list: unknown[]
): FriendCacheItem[] {
  const id = resolveAccountId(accountId);
  if (!id) return [];

  friendLRUCache.clear();
  const normalized = normalizeFriendCache(list);
  const now = Date.now();
  for (const f of normalized) {
    f.lastAccessed = now;
    friendLRUCache.set(f.gid, f);
  }

  // 保存到配置（只保留最多 500 个）
  const toSave = friendLRUCache.values();
  const current = getAccountConfigSnapshot(id);
  const next = normalizeAccountConfig(current, accountFallbackConfig);
  next.friendCache = toSave;
  setAccountConfigSnapshot(id, next);
  return toSave;
}

export function updateFriendCache(
  accountId: string | null | undefined,
  newItems: unknown[]
): FriendCacheItem[] {
  const id = resolveAccountId(accountId);
  if (!id) return [];

  // 确保 LRU 缓存已加载
  if (friendLRUCache.size() === 0) {
    getFriendCache(id);
  }

  const now = Date.now();
  const toAdd = normalizeFriendCache(newItems);
  for (const item of toAdd) {
    item.lastAccessed = now;
    friendLRUCache.set(item.gid, item);
  }

  // 保存到配置
  const toSave = friendLRUCache.values();
  const current = getAccountConfigSnapshot(id);
  const next = normalizeAccountConfig(current, accountFallbackConfig);
  next.friendCache = toSave;
  setAccountConfigSnapshot(id, next);
  return toSave;
}

export function getUI(): UIConfig {
  return { ...globalConfig.ui };
}

export function setUITheme(theme: string): ConfigSnapshot {
  const t = String(theme || '').toLowerCase();
  const next = t === 'light' ? 'light' : 'dark';
  return applyConfigSnapshot({ ui: { theme: next } });
}

export function getOfflineReminder(): OfflineReminderConfig {
  return normalizeOfflineReminder(globalConfig.offlineReminder);
}

export function setOfflineReminder(cfg: Partial<OfflineReminderConfig>): OfflineReminderConfig {
  const current = normalizeOfflineReminder(globalConfig.offlineReminder);
  globalConfig.offlineReminder = normalizeOfflineReminder({ ...current, ...(cfg || {}) });
  saveGlobalConfig();
  return getOfflineReminder();
}

export function getQrLoginConfig(): QrLoginConfig {
  return normalizeQrLoginConfig(globalConfig.qrLogin);
}

export function setQrLoginConfig(cfg: Partial<QrLoginConfig>): QrLoginConfig {
  const current = normalizeQrLoginConfig(globalConfig.qrLogin);
  globalConfig.qrLogin = normalizeQrLoginConfig({ ...current, ...(cfg || {}) });
  saveGlobalConfig();
  return getQrLoginConfig();
}

// ============ 账号管理 ============

/** 账号信息 */
export interface Account {
  id: string;
  name: string;
  code: string;
  platform: string;
  gid: string;
  openId: string;
  uin: string;
  qq: string;
  avatar: string;
  createdAt: number;
  updatedAt: number;
}

/** 账号数据 */
export interface AccountsData {
  accounts: Account[];
  nextId: number;
}

/** 添加或更新账号的输入 */
export interface AddOrUpdateAccountInput {
  id?: string;
  name?: string;
  nick?: string;
  code?: string;
  platform?: string;
  gid?: string | number | bigint;
  openId?: string;
  uin?: string | number;
  qq?: string | number;
  avatar?: string;
  avatarUrl?: string;
}

function loadAccounts(): AccountsData {
  ensureDataDir();
  const data = readJsonFile<AccountsData>(
    ACCOUNTS_FILE,
    () => ({ accounts: [], nextId: 1 })
  );
  return normalizeAccountsData(data);
}

function saveAccounts(data: AccountsData): void {
  ensureDataDir();
  writeJsonFileAtomic(ACCOUNTS_FILE, normalizeAccountsData(data));
}

export function getAccounts(): AccountsData {
  return loadAccounts();
}

function normalizeAccountsData(raw: unknown): AccountsData {
  const data = raw && typeof raw === 'object' ? (raw as AccountsData) : { accounts: [], nextId: 1 };
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const maxId = accounts.reduce(
    (m, a) => Math.max(m, Number.parseInt((a?.id as string) || '0', 10) || 0),
    0
  );
  let nextId = Number.parseInt(String(data.nextId), 10);
  if (!Number.isFinite(nextId) || nextId <= 0) nextId = maxId + 1;
  if (accounts.length === 0) nextId = 1;
  if (nextId <= maxId) nextId = maxId + 1;
  return { accounts, nextId };
}

export function addOrUpdateAccount(acc: AddOrUpdateAccountInput): AccountsData {
  const data = normalizeAccountsData(loadAccounts());
  let touchedAccountId = '';
  if (acc.id) {
    const idx = data.accounts.findIndex((a) => a.id === acc.id);
    if (idx >= 0) {
      data.accounts[idx] = {
        ...data.accounts[idx],
        ...acc,
        name: acc.name !== undefined ? acc.name : data.accounts[idx].name,
        updatedAt: Date.now(),
      };
      touchedAccountId = String(data.accounts[idx].id || '');
    }
  } else {
    const id = data.nextId++;
    touchedAccountId = String(id);
    const defaultName =
      String(
        acc.name || acc.nick || (acc.gid ? `GID:${acc.gid}` : '') || ''
      ).trim() || `账号${id}`;
    data.accounts.push({
      id: touchedAccountId,
      name: defaultName,
      code: acc.code || '',
      platform: acc.platform || 'qq',
      gid: acc.gid ? String(acc.gid) : '',
      openId: acc.openId ? String(acc.openId) : '',
      uin: acc.uin ? String(acc.uin) : '',
      qq: acc.qq ? String(acc.qq) : acc.uin ? String(acc.uin) : '',
      avatar: acc.avatar || acc.avatarUrl || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  saveAccounts(data);
  if (touchedAccountId) {
    ensureAccountConfig(touchedAccountId);
  }
  return data;
}

export function deleteAccount(id: string): AccountsData {
  const data = normalizeAccountsData(loadAccounts());
  data.accounts = data.accounts.filter((a) => a.id !== String(id));
  if (data.accounts.length === 0) {
    data.nextId = 1;
  }
  saveAccounts(data);
  removeAccountConfig(id);
  return data;
}
