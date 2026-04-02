/**
 * 配置校验 Schema 模块 - 统一配置校验和归一化
 * 替代 store.js 中重复的配置校验逻辑
 */

// ============ Schema 定义 ============

const SCHEMA_TYPES = {
    BOOLEAN: 'boolean',
    NUMBER: 'number',
    STRING: 'string',
    ENUM: 'enum',
    ARRAY: 'array',
    OBJECT: 'object',
    TIME_STRING: 'timeString',
};

// Module-level regex constants
const TIME_STRING_REGEX = /^(\d{1,2}):(\d{1,2})$/;
const HTTP_SCHEME_REGEX = /^https?:\/\//i;
const TRAILING_SLASH_REGEX = /\/$/;

// 允许的配置值集合
const ALLOWED_VALUES = {
    fertilizer: new Set(['both', 'normal', 'organic', 'none']),
    fertilizerBuyType: new Set(['organic', 'normal', 'both']),
    fertilizerBuyMode: new Set(['threshold', 'unlimited']),
    fertilizerLandTypes: new Set(['gold', 'black', 'red', 'normal']),
    plantingStrategy: new Set([
        'preferred', 'level', 'max_exp', 'max_fert_exp',
        'max_profit', 'max_fert_profit', 'bag_priority'
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
const LIMITS = {
    fertilizerBuyMax: { min: 1, max: 10 },
    fertilizerBuyThreshold: { min: 0, max: Infinity },
    interval: { min: 1, max: 86400 }, // 1秒到24小时
    blockLevel: { min: 1, max: Infinity },
    seedId: { min: 0, max: Infinity },
};

// ============ 校验器 ============

const validators = {
    [SCHEMA_TYPES.BOOLEAN]: (value, defaultValue) => {
        if (value === undefined || value === null) return defaultValue;
        return !!value;
    },

    [SCHEMA_TYPES.NUMBER]: (value, defaultValue, options = {}) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return defaultValue;
        const min = options.min ?? -Infinity;
        const max = options.max ?? Infinity;
        return Math.max(min, Math.min(max, n));
    },

    [SCHEMA_TYPES.STRING]: (value, defaultValue, options = {}) => {
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

    [SCHEMA_TYPES.ENUM]: (value, defaultValue, options = {}) => {
        const s = String(value ?? '').trim().toLowerCase();
        if (!s || !options.allowed?.has(s)) return defaultValue;
        return s;
    },

    [SCHEMA_TYPES.ARRAY]: (value, defaultValue, options = {}) => {
        if (!Array.isArray(value)) return defaultValue;
        const itemValidator = options.itemValidator;
        const maxLength = options.maxLength;

        let result = value;
        if (itemValidator) {
            result = value.map(item => itemValidator(item)).filter(v => v !== undefined);
        }
        if (maxLength && result.length > maxLength) {
            result = result.slice(0, maxLength);
        }
        // 去重
        if (options.unique) {
            result = [...new Set(result)];
        }
        return result;
    },

    [SCHEMA_TYPES.OBJECT]: (value, defaultValue) => {
        if (!value || typeof value !== 'object') return defaultValue;
        return { ...value };
    },

    [SCHEMA_TYPES.TIME_STRING]: (value, defaultValue) => {
        const s = String(value ?? '').trim();
        const m = s.match(TIME_STRING_REGEX);
        if (!m) return defaultValue;
        const hh = Math.max(0, Math.min(23, Number.parseInt(m[1], 10)));
        const mm = Math.max(0, Math.min(59, Number.parseInt(m[2], 10)));
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    },
};

// ============ Schema 定义表 ============

const automationSchema = {
    // 布尔值配置
    farm: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    farm_manage: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    farm_water: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    farm_weed: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    farm_bug: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    farm_push: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    land_upgrade: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    friend: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    friend_help_exp_limit: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    friend_steal: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    friend_help: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    friend_bad: { type: SCHEMA_TYPES.BOOLEAN, default: false },
    task: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    email: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    fertilizer_gift: { type: SCHEMA_TYPES.BOOLEAN, default: false },
    fertilizer_buy: { type: SCHEMA_TYPES.BOOLEAN, default: false },
    free_gifts: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    share_reward: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    vip_gift: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    month_card: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    open_server_gift: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    sell: { type: SCHEMA_TYPES.BOOLEAN, default: false },
    fertilizer_multi_season: { type: SCHEMA_TYPES.BOOLEAN, default: false },

    // 枚举配置
    fertilizer: {
        type: SCHEMA_TYPES.ENUM,
        allowed: ALLOWED_VALUES.fertilizer,
        default: 'none',
    },
    fertilizer_buy_type: {
        type: SCHEMA_TYPES.ENUM,
        allowed: ALLOWED_VALUES.fertilizerBuyType,
        default: 'organic',
    },
    fertilizer_buy_mode: {
        type: SCHEMA_TYPES.ENUM,
        allowed: ALLOWED_VALUES.fertilizerBuyMode,
        default: 'threshold',
    },

    // 数值配置
    fertilizer_buy_max: {
        type: SCHEMA_TYPES.NUMBER,
        ...LIMITS.fertilizerBuyMax,
        default: 10,
    },
    fertilizer_buy_threshold: {
        type: SCHEMA_TYPES.NUMBER,
        ...LIMITS.fertilizerBuyThreshold,
        default: 100,
    },

    // 数组配置
    fertilizer_land_types: {
        type: SCHEMA_TYPES.ARRAY,
        itemValidator: (v) => {
            const s = String(v ?? '').trim().toLowerCase();
            return ALLOWED_VALUES.fertilizerLandTypes.has(s) ? s : undefined;
        },
        default: ['gold', 'black', 'red', 'normal'],
        unique: true,
    },
    friend_steal_blacklist: {
        type: SCHEMA_TYPES.ARRAY,
        itemValidator: (v) => {
            const n = Number(v);
            return Number.isFinite(n) && n > 0 ? n : undefined;
        },
        default: [],
        unique: true,
    },
};

const intervalsSchema = {
    farm: { type: SCHEMA_TYPES.NUMBER, ...LIMITS.interval, default: 2 },
    friend: { type: SCHEMA_TYPES.NUMBER, ...LIMITS.interval, default: 10 },
    farmMin: { type: SCHEMA_TYPES.NUMBER, ...LIMITS.interval, default: 2 },
    farmMax: { type: SCHEMA_TYPES.NUMBER, ...LIMITS.interval, default: 2 },
    friendMin: { type: SCHEMA_TYPES.NUMBER, ...LIMITS.interval, default: 10 },
    friendMax: { type: SCHEMA_TYPES.NUMBER, ...LIMITS.interval, default: 10 },
};

const friendBlockLevelSchema = {
    enabled: { type: SCHEMA_TYPES.BOOLEAN, default: true },
    Level: { type: SCHEMA_TYPES.NUMBER, ...LIMITS.blockLevel, default: 1 },
};

const friendQuietHoursSchema = {
    enabled: { type: SCHEMA_TYPES.BOOLEAN, default: false },
    start: { type: SCHEMA_TYPES.TIME_STRING, default: '23:00' },
    end: { type: SCHEMA_TYPES.TIME_STRING, default: '07:00' },
};

const offlineReminderSchema = {
    channel: { type: SCHEMA_TYPES.ENUM, allowed: ALLOWED_VALUES.pushooChannel, default: 'webhook' },
    reloginUrlMode: { type: SCHEMA_TYPES.ENUM, allowed: ALLOWED_VALUES.reloginUrlMode, default: 'none' },
    endpoint: { type: SCHEMA_TYPES.STRING, default: '' },
    token: { type: SCHEMA_TYPES.STRING, default: '' },
    title: { type: SCHEMA_TYPES.STRING, default: '账号下线提醒' },
    msg: { type: SCHEMA_TYPES.STRING, default: '账号下线' },
    offlineDeleteSec: { type: SCHEMA_TYPES.NUMBER, min: 1, default: 1 },
    offlineDeleteEnabled: { type: SCHEMA_TYPES.BOOLEAN, default: false },
    custom_headers: { type: SCHEMA_TYPES.STRING, default: '' },
    custom_body: { type: SCHEMA_TYPES.STRING, default: '' },
};

const qrLoginSchema = {
    apiDomain: {
        type: SCHEMA_TYPES.STRING,
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

const runtimeClientSchema = {
    serverUrl: {
        type: SCHEMA_TYPES.STRING,
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
    clientVersion: {
        type: SCHEMA_TYPES.STRING,
        default: '',
        pattern: /^[\w.-]+$/,
        maxLength: 64,
    },
    os: {
        type: SCHEMA_TYPES.STRING,
        default: '',
        pattern: /^[\w.-]+$/,
        maxLength: 16,
    },
    device_info: {
        type: SCHEMA_TYPES.OBJECT,
        default: {},
        schema: {
            sys_software: { type: SCHEMA_TYPES.STRING, maxLength: 100, default: '' },
            network: { type: SCHEMA_TYPES.STRING, maxLength: 32, default: '' },
            memory: { type: SCHEMA_TYPES.STRING, maxLength: 32, default: '' },
            device_id: { type: SCHEMA_TYPES.STRING, maxLength: 120, default: '' },
        },
    },
};

const accountConfigSchema = {
    automation: { type: SCHEMA_TYPES.OBJECT, default: {}, schema: automationSchema },
    intervals: { type: SCHEMA_TYPES.OBJECT, default: {}, schema: intervalsSchema },
    friendBlockLevel: { type: SCHEMA_TYPES.OBJECT, default: {}, schema: friendBlockLevelSchema },
    friendQuietHours: { type: SCHEMA_TYPES.OBJECT, default: {}, schema: friendQuietHoursSchema },
    plantingStrategy: { type: SCHEMA_TYPES.ENUM, allowed: ALLOWED_VALUES.plantingStrategy, default: 'preferred' },
    preferredSeedId: { type: SCHEMA_TYPES.NUMBER, ...LIMITS.seedId, default: 0 },
    bagSeedPriority: {
        type: SCHEMA_TYPES.ARRAY,
        itemValidator: (v) => {
            const n = Number(v);
            return Number.isFinite(n) && n > 0 ? n : undefined;
        },
        default: [],
        unique: true,
    },
    friendBlacklist: {
        type: SCHEMA_TYPES.ARRAY,
        itemValidator: (v) => {
            const n = Number(v);
            return Number.isFinite(n) && n > 0 ? n : undefined;
        },
        default: [],
        unique: true,
    },
};

// ============ 核心校验函数 ============

/**
 * 根据 Schema 校验单个值
 * @param {any} value 输入值
 * @param {object} schema 字段 Schema
 * @returns {any} 校验后的值
 */
function validateBySchema(value, schema) {
    const { type, default: defaultValue, validator, schema: nestedSchema } = schema;

    // 使用自定义校验器
    if (validator) {
        return validator(value, defaultValue);
    }

    // 嵌套对象 Schema
    if (type === SCHEMA_TYPES.OBJECT && nestedSchema) {
        const obj = validators[type](value, defaultValue);
        if (!obj) return defaultValue;
        const result = {};
        for (const [key, fieldSchema] of Object.entries(nestedSchema)) {
            result[key] = validateBySchema(obj[key], fieldSchema);
        }
        return result;
    }

    // 基础类型校验
    const validatorFn = validators[type];
    if (!validatorFn) return defaultValue;

    return validatorFn(value, defaultValue, schema);
}

/**
 * 校验对象配置
 * @param {object} input 输入配置
 * @param {object} schema Schema 定义
 * @param {object} base 基础配置（用于继承默认值）
 * @returns {object} 校验后的配置
 */
function validateObject(input, schema, base = null) {
    const src = (input && typeof input === 'object') ? input : {};
    const result = {};

    for (const [key, fieldSchema] of Object.entries(schema)) {
        // 优先使用输入值，否则使用基础配置，最后使用默认值
        const value = src[key] !== undefined ? src[key] : (base?.[key]);
        result[key] = validateBySchema(value, fieldSchema);
    }

    return result;
}

/**
 * 校验自动化配置
 * @param {object} input 输入配置
 * @param {object} base 基础配置
 * @returns {object} 校验后的配置
 */
function validateAutomation(input, base = null) {
    const result = validateObject(input, automationSchema, base);

    // 特殊逻辑：unlimited 模式下 fertilizer_buy_type 不能为 both
    if (result.fertilizer_buy_mode === 'unlimited' && result.fertilizer_buy_type === 'both') {
        result.fertilizer_buy_type = 'organic';
    }

    return result;
}

/**
 * 校验间隔配置
 * @param {object} input 输入配置
 * @param {object} base 基础配置
 * @returns {object} 校验后的配置
 */
function validateIntervals(input, base = null) {
    const result = validateObject(input, intervalsSchema, base);

    // 确保 min <= max
    if (result.farmMin > result.farmMax) {
        [result.farmMin, result.farmMax] = [result.farmMax, result.farmMin];
    }
    if (result.friendMin > result.friendMax) {
        [result.friendMin, result.friendMax] = [result.friendMax, result.friendMin];
    }

    return result;
}

/**
 * 校验账号配置
 * @param {object} input 输入配置
 * @param {object} fallback 回退配置
 * @returns {object} 校验后的配置
 */
function validateAccountConfig(input, fallback = null) {
    const baseAutomation = fallback?.automation;
    const baseIntervals = fallback?.intervals;

    return {
        ...validateObject(input, accountConfigSchema, fallback),
        automation: validateAutomation(input?.automation, baseAutomation),
        intervals: validateIntervals(input?.intervals, baseIntervals),
        friendBlockLevel: validateObject(input?.friendBlockLevel, friendBlockLevelSchema, fallback?.friendBlockLevel),
        friendQuietHours: validateObject(input?.friendQuietHours, friendQuietHoursSchema, fallback?.friendQuietHours),
        friendBlacklist: validateBySchema(input?.friendBlacklist, accountConfigSchema.friendBlacklist),
    };
}

/**
 * 校验离线提醒配置
 * @param {object} input 输入配置
 * @returns {object} 校验后的配置
 */
function validateOfflineReminder(input) {
    return validateObject(input, offlineReminderSchema);
}

/**
 * 校验 QR 登录配置
 * @param {object} input 输入配置
 * @returns {object} 校验后的配置
 */
function validateQrLoginConfig(input) {
    return validateObject(input, qrLoginSchema);
}

/**
 * 校验运行时客户端配置
 * @param {object} input 输入配置
 * @param {object} fallback 回退配置
 * @returns {object} 校验后的配置
 */
function validateRuntimeClientConfig(input, fallback = null) {
    const result = validateObject(input, runtimeClientSchema, fallback);

    // device_info.client_version 始终由 clientVersion 派生
    if (result.device_info) {
        result.device_info.client_version = result.clientVersion;
    }

    return result;
}

/**
 * 校验好友缓存项
 * @param {any} item 输入项
 * @returns {object|null} 校验后的项或 null
 */
function validateFriendCacheItem(item) {
    if (!item || typeof item !== 'object') return null;
    const gid = Number(item.gid);
    if (!Number.isFinite(gid) || gid <= 0) return null;
    return {
        gid,
        nick: String(item.nick || item.name || '').trim() || `GID:${gid}`,
        avatarUrl: String(item.avatarUrl || item.avatar_url || '').trim(),
        lastAccessed: item.lastAccessed || Date.now(),
    };
}

/**
 * 校验好友缓存列表
 * @param {Array} input 输入列表
 * @returns {Array} 校验后的列表
 */
function validateFriendCache(input) {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const result = [];
    for (const item of input) {
        const validated = validateFriendCacheItem(item);
        if (!validated || seen.has(validated.gid)) continue;
        seen.add(validated.gid);
        result.push(validated);
    }
    return result;
}

// ============ 导出 ============

module.exports = {
    SCHEMA_TYPES,
    ALLOWED_VALUES,
    LIMITS,
    schemas: {
        automation: automationSchema,
        intervals: intervalsSchema,
        friendBlockLevel: friendBlockLevelSchema,
        friendQuietHours: friendQuietHoursSchema,
        accountConfig: accountConfigSchema,
        offlineReminder: offlineReminderSchema,
        qrLogin: qrLoginSchema,
        runtimeClient: runtimeClientSchema,
    },
    validateBySchema,
    validateObject,
    validateAutomation,
    validateIntervals,
    validateAccountConfig,
    validateOfflineReminder,
    validateQrLoginConfig,
    validateRuntimeClientConfig,
    validateFriendCache,
};
