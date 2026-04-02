/**
 * 配置校验 Schema 模块 - 统一配置校验和归一化
 * 替代 store.js 中重复的配置校验逻辑
 */

// ============ Schema 定义 ============

export enum SchemaType {
  BOOLEAN = 'boolean',
  NUMBER = 'number',
  STRING = 'string',
  ENUM = 'enum',
  ARRAY = 'array',
  OBJECT = 'object',
  TIME_STRING = 'timeString',
}

// Module-level regex constants
const TIME_STRING_REGEX = /^(\d{1,2}):(\d{1,2})$/;
const HTTP_SCHEME_REGEX = /^https?:\/\//i;
const TRAILING_SLASH_REGEX = /\/$/;

// 允许的配置值集合
export const ALLOWED_VALUES = {
  fertilizer: new Set(['both', 'normal', 'organic', 'none']),
  fertilizerBuyType: new Set(['organic', 'normal', 'both']),
  fertilizerBuyMode: new Set(['threshold', 'unlimited']),
  fertilizerLandTypes: new Set(['gold', 'black', 'red', 'normal']),
  plantingStrategy: new Set([
    'preferred', 'level', 'max_exp', 'max_fert_exp',
    'max_profit', 'max_fert_profit', 'bag_priority',
  ]),
  reloginUrlMode: new Set(['none', 'qq_link', 'qr_code', 'all']),
  pushooChannel: new Set([
    'webhook', 'qmsg', 'serverchan', 'pushplus', 'pushplushxtrip',
    'dingtalk', 'wecom', 'bark', 'gocqhttp', 'onebot', 'atri',
    'pushdeer', 'igot', 'telegram', 'feishu', 'ifttt', 'wecombot',
    'discord', 'wxpusher', 'custom_request',
  ]),
};

// 范围限制
export const LIMITS = {
  fertilizerBuyMax: { min: 1, max: 10 },
  fertilizerBuyThreshold: { min: 0, max: Infinity },
  interval: { min: 1, max: 86400 },
  blockLevel: { min: 1, max: Infinity },
  seedId: { min: 0, max: Infinity },
};

// ============ 类型定义 ============

interface FieldSchema {
  type: SchemaType;
  default?: unknown;
  allowed?: Set<string>;
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: RegExp;
  itemValidator?: (v: unknown) => unknown | undefined;
  unique?: boolean;
  validator?: (v: unknown, defaultValue: unknown) => unknown;
  schema?: Record<string, FieldSchema>;
}

type ValidatorFn = (value: unknown, defaultValue: unknown, options?: Partial<FieldSchema>) => unknown;

// ============ 校验器 ============

const validators: Record<SchemaType, ValidatorFn> = {
  [SchemaType.BOOLEAN]: (value, defaultValue) => {
    if (value === undefined || value === null) return defaultValue;
    return !!value;
  },

  [SchemaType.NUMBER]: (value, defaultValue, options = {}) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return defaultValue;
    const min = options.min ?? -Infinity;
    const max = options.max ?? Infinity;
    return Math.max(min, Math.min(max, n));
  },

  [SchemaType.STRING]: (value, defaultValue, options = {}) => {
    const s = String(value ?? '').trim();
    if (!s) return defaultValue;
    if (options.maxLength && s.length > options.maxLength) {
      return s.slice(0, options.maxLength);
    }
    if (options.pattern && !options.pattern.test(s)) {
      return defaultValue;
    }
    return s;
  },

  [SchemaType.ENUM]: (value, defaultValue, options = {}) => {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s || !options.allowed?.has(s)) return defaultValue;
    return s;
  },

  [SchemaType.ARRAY]: (value, defaultValue, options = {}) => {
    if (!Array.isArray(value)) return defaultValue;
    const itemValidator = options.itemValidator;
    const maxLength = options.maxLength;

    let result: unknown[] = value;
    if (itemValidator) {
      result = value.map(item => itemValidator(item)).filter(v => v !== undefined);
    }
    if (maxLength && result.length > maxLength) {
      result = result.slice(0, maxLength);
    }
    if (options.unique) {
      result = [...new Set(result)];
    }
    return result;
  },

  [SchemaType.OBJECT]: (value, defaultValue) => {
    if (!value || typeof value !== 'object') return defaultValue;
    return { ...value };
  },

  [SchemaType.TIME_STRING]: (value, defaultValue) => {
    const s = String(value ?? '').trim();
    const m = s.match(TIME_STRING_REGEX);
    if (!m) return defaultValue;
    const hh = Math.max(0, Math.min(23, Number.parseInt(m[1], 10)));
    const mm = Math.max(0, Math.min(59, Number.parseInt(m[2], 10)));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  },
};

// ============ Schema 定义表 ============

const automationSchema: Record<string, FieldSchema> = {
  farm: { type: SchemaType.BOOLEAN, default: true },
  farm_manage: { type: SchemaType.BOOLEAN, default: true },
  farm_water: { type: SchemaType.BOOLEAN, default: true },
  farm_weed: { type: SchemaType.BOOLEAN, default: true },
  farm_bug: { type: SchemaType.BOOLEAN, default: true },
  farm_push: { type: SchemaType.BOOLEAN, default: true },
  land_upgrade: { type: SchemaType.BOOLEAN, default: true },
  friend: { type: SchemaType.BOOLEAN, default: true },
  friend_help_exp_limit: { type: SchemaType.BOOLEAN, default: true },
  friend_steal: { type: SchemaType.BOOLEAN, default: true },
  friend_help: { type: SchemaType.BOOLEAN, default: true },
  friend_bad: { type: SchemaType.BOOLEAN, default: false },
  task: { type: SchemaType.BOOLEAN, default: true },
  email: { type: SchemaType.BOOLEAN, default: true },
  fertilizer_gift: { type: SchemaType.BOOLEAN, default: false },
  fertilizer_buy: { type: SchemaType.BOOLEAN, default: false },
  free_gifts: { type: SchemaType.BOOLEAN, default: true },
  share_reward: { type: SchemaType.BOOLEAN, default: true },
  vip_gift: { type: SchemaType.BOOLEAN, default: true },
  month_card: { type: SchemaType.BOOLEAN, default: true },
  open_server_gift: { type: SchemaType.BOOLEAN, default: true },
  sell: { type: SchemaType.BOOLEAN, default: false },
  fertilizer_multi_season: { type: SchemaType.BOOLEAN, default: false },
  fertilizer: { type: SchemaType.ENUM, allowed: ALLOWED_VALUES.fertilizer, default: 'none' },
  fertilizer_buy_type: { type: SchemaType.ENUM, allowed: ALLOWED_VALUES.fertilizerBuyType, default: 'organic' },
  fertilizer_buy_mode: { type: SchemaType.ENUM, allowed: ALLOWED_VALUES.fertilizerBuyMode, default: 'threshold' },
  fertilizer_buy_max: { type: SchemaType.NUMBER, ...LIMITS.fertilizerBuyMax, default: 10 },
  fertilizer_buy_threshold: { type: SchemaType.NUMBER, ...LIMITS.fertilizerBuyThreshold, default: 100 },
  fertilizer_land_types: {
    type: SchemaType.ARRAY,
    itemValidator: (v) => {
      const s = String(v ?? '').trim().toLowerCase();
      return ALLOWED_VALUES.fertilizerLandTypes.has(s) ? s : undefined;
    },
    default: ['gold', 'black', 'red', 'normal'],
    unique: true,
  },
  friend_steal_blacklist: {
    type: SchemaType.ARRAY,
    itemValidator: (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    },
    default: [],
    unique: true,
  },
};

const intervalsSchema: Record<string, FieldSchema> = {
  farm: { type: SchemaType.NUMBER, ...LIMITS.interval, default: 2 },
  friend: { type: SchemaType.NUMBER, ...LIMITS.interval, default: 10 },
  farmMin: { type: SchemaType.NUMBER, ...LIMITS.interval, default: 2 },
  farmMax: { type: SchemaType.NUMBER, ...LIMITS.interval, default: 2 },
  friendMin: { type: SchemaType.NUMBER, ...LIMITS.interval, default: 10 },
  friendMax: { type: SchemaType.NUMBER, ...LIMITS.interval, default: 10 },
};

const friendBlockLevelSchema: Record<string, FieldSchema> = {
  enabled: { type: SchemaType.BOOLEAN, default: true },
  Level: { type: SchemaType.NUMBER, ...LIMITS.blockLevel, default: 1 },
};

const friendQuietHoursSchema: Record<string, FieldSchema> = {
  enabled: { type: SchemaType.BOOLEAN, default: false },
  start: { type: SchemaType.TIME_STRING, default: '23:00' },
  end: { type: SchemaType.TIME_STRING, default: '07:00' },
};

const offlineReminderSchema: Record<string, FieldSchema> = {
  channel: { type: SchemaType.ENUM, allowed: ALLOWED_VALUES.pushooChannel, default: 'webhook' },
  reloginUrlMode: { type: SchemaType.ENUM, allowed: ALLOWED_VALUES.reloginUrlMode, default: 'none' },
  endpoint: { type: SchemaType.STRING, default: '' },
  token: { type: SchemaType.STRING, default: '' },
  title: { type: SchemaType.STRING, default: '账号下线提醒' },
  msg: { type: SchemaType.STRING, default: '账号下线' },
  offlineDeleteSec: { type: SchemaType.NUMBER, min: 1, default: 1 },
  offlineDeleteEnabled: { type: SchemaType.BOOLEAN, default: false },
  custom_headers: { type: SchemaType.STRING, default: '' },
  custom_body: { type: SchemaType.STRING, default: '' },
};

const qrLoginSchema: Record<string, FieldSchema> = {
  apiDomain: {
    type: SchemaType.STRING,
    default: 'q.qq.com',
    validator: (v) => {
      const raw = String(v || '').trim();
      if (!raw) return 'q.qq.com';
      const normalized = HTTP_SCHEME_REGEX.test(raw) ? raw : `https://${raw}`;
      try {
        const parsed = new URL(normalized);
        return parsed.host || 'q.qq.com';
      } catch {
        return 'q.qq.com';
      }
    },
  },
};

const runtimeClientSchema: Record<string, FieldSchema> = {
  serverUrl: {
    type: SchemaType.STRING,
    default: '',
    validator: (v, defaultValue) => {
      const raw = String(v || '').trim();
      if (!raw) return defaultValue;
      if (raw.includes('?') || raw.includes('#')) return defaultValue;
      try {
        const parsed = new URL(raw);
        const protocol = String(parsed.protocol || '').toLowerCase();
        if (protocol !== 'ws:' && protocol !== 'wss:') return defaultValue;
        return parsed.toString().replace(TRAILING_SLASH_REGEX, '');
      } catch {
        return defaultValue;
      }
    },
  },
  clientVersion: { type: SchemaType.STRING, default: '', pattern: /^[\w.-]+$/, maxLength: 64 },
  os: { type: SchemaType.STRING, default: '', pattern: /^[\w.-]+$/, maxLength: 16 },
  device_info: {
    type: SchemaType.OBJECT,
    default: {},
    schema: {
      sys_software: { type: SchemaType.STRING, maxLength: 100, default: '' },
      network: { type: SchemaType.STRING, maxLength: 32, default: '' },
      memory: { type: SchemaType.STRING, maxLength: 32, default: '' },
      device_id: { type: SchemaType.STRING, maxLength: 120, default: '' },
    },
  },
};

const accountConfigSchema: Record<string, FieldSchema> = {
  automation: { type: SchemaType.OBJECT, default: {}, schema: automationSchema },
  intervals: { type: SchemaType.OBJECT, default: {}, schema: intervalsSchema },
  friendBlockLevel: { type: SchemaType.OBJECT, default: {}, schema: friendBlockLevelSchema },
  friendQuietHours: { type: SchemaType.OBJECT, default: {}, schema: friendQuietHoursSchema },
  plantingStrategy: { type: SchemaType.ENUM, allowed: ALLOWED_VALUES.plantingStrategy, default: 'preferred' },
  preferredSeedId: { type: SchemaType.NUMBER, ...LIMITS.seedId, default: 0 },
  bagSeedPriority: {
    type: SchemaType.ARRAY,
    itemValidator: (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    },
    default: [],
    unique: true,
  },
  friendBlacklist: {
    type: SchemaType.ARRAY,
    itemValidator: (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    },
    default: [],
    unique: true,
  },
};

// ============ 导出 Schema ============

export const schemas = {
  automation: automationSchema,
  intervals: intervalsSchema,
  friendBlockLevel: friendBlockLevelSchema,
  friendQuietHours: friendQuietHoursSchema,
  accountConfig: accountConfigSchema,
  offlineReminder: offlineReminderSchema,
  qrLogin: qrLoginSchema,
  runtimeClient: runtimeClientSchema,
};

// ============ 核心校验函数 ============

/**
 * 根据 Schema 校验单个值
 */
export function validateBySchema(value: unknown, schema: FieldSchema): unknown {
  const { type, default: defaultValue, validator, schema: nestedSchema } = schema;

  if (validator) {
    return validator(value, defaultValue);
  }

  if (type === SchemaType.OBJECT && nestedSchema) {
    const obj = validators[type](value, defaultValue, schema) as Record<string, unknown> | null;
    if (!obj) return defaultValue;
    const result: Record<string, unknown> = {};
    for (const [key, fieldSchema] of Object.entries(nestedSchema)) {
      result[key] = validateBySchema(obj[key], fieldSchema);
    }
    return result;
  }

  const validatorFn = validators[type];
  if (!validatorFn) return defaultValue;

  return validatorFn(value, defaultValue, schema);
}

interface BaseConfig {
  automation?: Record<string, unknown>;
  intervals?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 校验对象配置
 */
export function validateObject<T extends Record<string, unknown>>(
  input: unknown,
  schema: Record<string, FieldSchema>,
  base: T | null = null,
): T {
  const src = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const result = {} as Record<string, unknown>;

  for (const [key, fieldSchema] of Object.entries(schema)) {
    const value = (src as Record<string, unknown>)[key] !== undefined
      ? (src as Record<string, unknown>)[key]
      : base?.[key];
    result[key] = validateBySchema(value, fieldSchema);
  }

  return result as T;
}

/**
 * 校验自动化配置
 */
export function validateAutomation(input: unknown, base: Record<string, unknown> | null = null): Record<string, unknown> {
  const result = validateObject(input, automationSchema, base);

  if (result.fertilizer_buy_mode === 'unlimited' && result.fertilizer_buy_type === 'both') {
    result.fertilizer_buy_type = 'organic';
  }

  return result;
}

export interface IntervalsConfig extends Record<string, unknown> {
  farm: number;
  friend: number;
  farmMin: number;
  farmMax: number;
  friendMin: number;
  friendMax: number;
}

/**
 * 校验间隔配置
 */
export function validateIntervals(input: unknown, base: IntervalsConfig | null = null): IntervalsConfig {
  const result = validateObject<IntervalsConfig>(input, intervalsSchema, base);

  if (result.farmMin > result.farmMax) {
    [result.farmMin, result.farmMax] = [result.farmMax, result.farmMin];
  }
  if (result.friendMin > result.friendMax) {
    [result.friendMin, result.friendMax] = [result.friendMax, result.friendMin];
  }

  return result;
}

export interface AccountConfig extends Record<string, unknown> {
  automation: Record<string, unknown>;
  intervals: IntervalsConfig;
  friendBlockLevel: Record<string, unknown>;
  friendQuietHours: Record<string, unknown>;
  plantingStrategy: string;
  preferredSeedId: number;
  bagSeedPriority: number[];
  friendBlacklist: number[];
}

/**
 * 校验账号配置
 */
export function validateAccountConfig(input: unknown, fallback: AccountConfig | null = null): AccountConfig {
  const baseAutomation = fallback?.automation;
  const baseIntervals = fallback?.intervals;

  return {
    ...validateObject(input, accountConfigSchema, fallback),
    automation: validateAutomation((input as BaseConfig)?.automation, baseAutomation),
    intervals: validateIntervals((input as BaseConfig)?.intervals, baseIntervals),
    friendBlockLevel: validateObject((input as BaseConfig)?.friendBlockLevel, friendBlockLevelSchema, fallback?.friendBlockLevel),
    friendQuietHours: validateObject((input as BaseConfig)?.friendQuietHours, friendQuietHoursSchema, fallback?.friendQuietHours),
    friendBlacklist: validateBySchema((input as BaseConfig)?.friendBlacklist, accountConfigSchema.friendBlacklist) as number[],
  } as AccountConfig;
}

/**
 * 校验离线提醒配置
 */
export function validateOfflineReminder(input: unknown): Record<string, unknown> {
  return validateObject(input, offlineReminderSchema);
}

/**
 * 校验 QR 登录配置
 */
export function validateQrLoginConfig(input: unknown): Record<string, unknown> {
  return validateObject(input, qrLoginSchema);
}

/**
 * 校验运行时客户端配置
 */
export function validateRuntimeClientConfig(input: unknown, fallback: Record<string, unknown> | null = null): Record<string, unknown> {
  const result = validateObject(input, runtimeClientSchema, fallback);

  if (result.device_info) {
    (result.device_info as Record<string, unknown>).client_version = result.clientVersion;
  }

  return result;
}

export interface FriendCacheItem {
  gid: number;
  nick: string;
  avatarUrl: string;
  lastAccessed: number;
}

/**
 * 校验好友缓存项
 */
export function validateFriendCacheItem(item: unknown): FriendCacheItem | null {
  if (!item || typeof item !== 'object') return null;
  const it = item as Record<string, unknown>;
  const gid = Number(it.gid);
  if (!Number.isFinite(gid) || gid <= 0) return null;
  return {
    gid,
    nick: String(it.nick || (it as { name?: string }).name || '').trim() || `GID:${gid}`,
    avatarUrl: String(it.avatarUrl || (it as { avatar_url?: string }).avatar_url || '').trim(),
    lastAccessed: (it.lastAccessed as number) || Date.now(),
  };
}

/**
 * 校验好友缓存列表
 */
export function validateFriendCache(input: unknown): FriendCacheItem[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const result: FriendCacheItem[] = [];
  for (const item of input) {
    const validated = validateFriendCacheItem(item);
    if (!validated || seen.has(validated.gid)) continue;
    seen.add(validated.gid);
    result.push(validated);
  }
  return result;
}
