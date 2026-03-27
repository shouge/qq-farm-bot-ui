const process = require('node:process');
/**
 * 运行时存储 - 自动化开关、种子偏好、账号管理
 */

const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { CONFIG: BASE_CONFIG } = require('../config/config');
const { readTextFile, readJsonFile, writeJsonFileAtomic } = require('../services/json-db');
const {
    validateAccountConfig,
    validateOfflineReminder,
    validateQrLoginConfig,
    validateRuntimeClientConfig,
    validateFriendCache,
} = require('../utils/config-schema');

// 批量写入配置
const SAVE_DEBOUNCE_MS = 500; // 500ms内多次变更合并为一次写入
let saveTimer = null;
let pendingSave = false;

const STORE_FILE = getDataFile('store.json');
const ACCOUNTS_FILE = getDataFile('accounts.json');
const DEFAULT_OFFLINE_DELETE_SEC = 1;
const DEFAULT_OFFLINE_REMINDER = {
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

const DEFAULT_QR_LOGIN = {
    apiDomain: 'q.qq.com',
};

const DEFAULT_RUNTIME_CLIENT = {
    serverUrl: BASE_CONFIG.serverUrl,
    clientVersion: BASE_CONFIG.clientVersion,
    os: BASE_CONFIG.os,
    device_info: {
        sys_software: (BASE_CONFIG.device_info && BASE_CONFIG.device_info.sys_software) ? BASE_CONFIG.device_info.sys_software : 'iOS 26.2.1',
        network: (BASE_CONFIG.device_info && BASE_CONFIG.device_info.network) ? BASE_CONFIG.device_info.network : 'wifi',
        memory: (BASE_CONFIG.device_info && BASE_CONFIG.device_info.memory) ? BASE_CONFIG.device_info.memory : '7672',
        device_id: (BASE_CONFIG.device_info && BASE_CONFIG.device_info.device_id) ? BASE_CONFIG.device_info.device_id : 'iPhone X<iPhone18,3>',
    },
};
// ============ LRU 缓存实现 ============
class LRUCache {
    constructor(maxSize = 500) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return undefined;
        // 移动到末尾（最近访问）
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // 淘汰最久未访问的（第一个）
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        return this.cache.delete(key);
    }

    size() {
        return this.cache.size;
    }

    clear() {
        this.cache.clear();
    }

    // 获取所有值（按访问顺序）
    values() {
        return Array.from(this.cache.values());
    }

    // 批量设置（保留访问顺序）
    setAll(entries) {
        this.cache.clear();
        for (const entry of entries) {
            if (entry && entry.gid) {
                this.cache.set(entry.gid, entry);
            }
        }
    }
}

// 好友 LRU 缓存实例（限制 500 个）
const friendLRUCache = new LRUCache(500);
const DEFAULT_ACCOUNT_CONFIG = {
    automation: {
        farm: true,
        farm_manage: true, // 农场打理总开关（浇水/除草/除虫）
        farm_water: true, // 自动浇水
        farm_weed: true, // 自动除草
        farm_bug: true, // 自动除虫
        farm_push: true,   // 收到 LandsNotify 推送时是否立即触发巡田
        land_upgrade: true, // 是否自动升级土地
        friend: true,       // 好友互动总开关
        friend_help_exp_limit: true, // 帮忙经验达上限后自动停止帮忙
        friend_steal: true, // 偷菜
        friend_steal_blacklist: [], // 偷菜作物黑名单（按作物ID）
        friend_help: true,  // 帮忙
        friend_bad: false,  // 捣乱(放虫草)
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
let accountFallbackConfig = {
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

const globalConfig = {
    accountConfigs: {},
    defaultAccountConfig: cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG),
    ui: {
        theme: 'dark',
    },
    offlineReminder: { ...DEFAULT_OFFLINE_REMINDER },
    qrLogin: { ...DEFAULT_QR_LOGIN },
    runtimeClient: { ...DEFAULT_RUNTIME_CLIENT, device_info: { ...DEFAULT_RUNTIME_CLIENT.device_info } },
    adminPasswordHash: '',
    disablePasswordAuth: false,
};

function normalizeOfflineReminder(input) {
    return validateOfflineReminder(input);
}


function normalizeQrLoginConfig(input) {
    return validateQrLoginConfig(input);
}

function normalizeRuntimeClientConfig(input, fallback = null) {
    const base = fallback || {
        serverUrl: BASE_CONFIG.serverUrl,
        clientVersion: BASE_CONFIG.clientVersion,
        os: BASE_CONFIG.os,
        device_info: BASE_CONFIG.device_info || {},
    };
    return validateRuntimeClientConfig(input, base);
}

function getRuntimeClientConfig() {
    const current = globalConfig.runtimeClient;
    const base = {
        serverUrl: BASE_CONFIG.serverUrl,
        clientVersion: BASE_CONFIG.clientVersion,
        os: BASE_CONFIG.os,
        device_info: BASE_CONFIG.device_info || {},
    };
    const validated = validateRuntimeClientConfig(current, base);
    // device_info.client_version 永远由 clientVersion 派生
    return {
        ...validated,
        device_info: {
            ...validated.device_info,
            client_version: validated.clientVersion,
        },
    };
}

function setRuntimeClientConfig(cfg) {
    const current = getRuntimeClientConfig();
    const merged = {
        ...current,
        ...cfg,
        device_info: {
            ...(current.device_info || {}),
            ...(cfg?.device_info || {}),
        },
    };
    const validated = validateRuntimeClientConfig(merged, {
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
function normalizeFriendCache(input) {
    return validateFriendCache(input);
}

function mergeFriendCache(existing, newItems) {
    const merged = normalizeFriendCache(existing);
    const seen = new Set(merged.map(f => f.gid));
    const toAdd = normalizeFriendCache(newItems);
    for (const item of toAdd) {
        if (seen.has(item.gid)) {
            const idx = merged.findIndex(f => f.gid === item.gid);
            if (idx >= 0) {
                merged[idx] = { ...merged[idx], ...item };
            }
        } else {
            seen.add(item.gid);
            merged.push(item);
        }
    }
    return merged;
}

function cloneAccountConfig(base = DEFAULT_ACCOUNT_CONFIG) {
    return validateAccountConfig(base, DEFAULT_ACCOUNT_CONFIG);
}

function resolveAccountId(accountId) {
    const direct = (accountId !== undefined && accountId !== null) ? String(accountId).trim() : '';
    if (direct) return direct;
    const envId = String(process.env.FARM_ACCOUNT_ID || '').trim();
    return envId;
}

function normalizeAccountConfig(input, fallback = accountFallbackConfig) {
    return validateAccountConfig(input, fallback);
}

function getAccountConfigSnapshot(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return cloneAccountConfig(accountFallbackConfig);
    return normalizeAccountConfig(globalConfig.accountConfigs[id], accountFallbackConfig);
}

function setAccountConfigSnapshot(accountId, nextConfig, persist = true) {
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

function removeAccountConfig(accountId) {
    const id = resolveAccountId(accountId);
    if (!id) return;
    if (globalConfig.accountConfigs[id]) {
        delete globalConfig.accountConfigs[id];
        saveGlobalConfig();
    }
}

function ensureAccountConfig(accountId, options = {}) {
    const id = resolveAccountId(accountId);
    if (!id) return null;
    if (globalConfig.accountConfigs[id]) {
        return cloneAccountConfig(globalConfig.accountConfigs[id]);
    }
    globalConfig.accountConfigs[id] = normalizeAccountConfig(globalConfig.defaultAccountConfig, accountFallbackConfig);
    // 新账号默认不施肥（不受历史 defaultAccountConfig 旧值影响）
    if (globalConfig.accountConfigs[id] && globalConfig.accountConfigs[id].automation) {
        globalConfig.accountConfigs[id].automation.fertilizer = 'none';
    }
    if (options.persist !== false) saveGlobalConfig();
    return cloneAccountConfig(globalConfig.accountConfigs[id]);
}

// 加载全局配置
function loadGlobalConfig() {
    ensureDataDir();
    try {
        const data = readJsonFile(STORE_FILE, () => ({}));
        if (data && typeof data === 'object') {
            if (data.defaultAccountConfig && typeof data.defaultAccountConfig === 'object') {
                accountFallbackConfig = normalizeAccountConfig(data.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
            } else {
                accountFallbackConfig = cloneAccountConfig(DEFAULT_ACCOUNT_CONFIG);
            }
            globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

            const cfgMap = (data.accountConfigs && typeof data.accountConfigs === 'object')
                ? data.accountConfigs
                : {};
            globalConfig.accountConfigs = {};
            for (const [id, cfg] of Object.entries(cfgMap)) {
                const sid = String(id || '').trim();
                if (!sid) continue;
                globalConfig.accountConfigs[sid] = normalizeAccountConfig(cfg, accountFallbackConfig);
            }
            // 统一规范化，确保内存中不残留旧字段（如 automation.friend）
            globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);
            for (const [id, cfg] of Object.entries(globalConfig.accountConfigs)) {
                globalConfig.accountConfigs[id] = normalizeAccountConfig(cfg, accountFallbackConfig);
            }
            globalConfig.ui = { ...globalConfig.ui, ...(data.ui || {}) };
            const theme = String(globalConfig.ui.theme || '').toLowerCase();
            globalConfig.ui.theme = theme === 'light' ? 'light' : 'dark';
            globalConfig.offlineReminder = normalizeOfflineReminder(data.offlineReminder);
            globalConfig.qrLogin = normalizeQrLoginConfig(data.qrLogin);
            if (data.runtimeClient && typeof data.runtimeClient === 'object') {
                // normalize 时使用当前 default 作为 fallback
                normalizeRuntimeClientConfig.current = DEFAULT_RUNTIME_CLIENT;
                const normalized = normalizeRuntimeClientConfig(data.runtimeClient);
                delete normalizeRuntimeClientConfig.current;
                globalConfig.runtimeClient = {
                    ...normalized,
                    device_info: { ...(normalized.device_info || {}) },
                };
            } else {
                globalConfig.runtimeClient = { ...DEFAULT_RUNTIME_CLIENT, device_info: { ...DEFAULT_RUNTIME_CLIENT.device_info } };
            }
            if (typeof data.adminPasswordHash === 'string') {
                globalConfig.adminPasswordHash = data.adminPasswordHash;
            }
            if (typeof data.disablePasswordAuth === 'boolean') {
                globalConfig.disablePasswordAuth = data.disablePasswordAuth;
            }
        }
    } catch (e) {
        console.error('加载配置失败:', e.message);
    }
}

function sanitizeGlobalConfigBeforeSave() {
    // default 配置统一白名单净化
    accountFallbackConfig = normalizeAccountConfig(globalConfig.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
    globalConfig.defaultAccountConfig = cloneAccountConfig(accountFallbackConfig);

    // 每个账号配置也统一净化
    const map = (globalConfig.accountConfigs && typeof globalConfig.accountConfigs === 'object')
        ? globalConfig.accountConfigs
        : {};
    const nextMap = {};
    for (const [id, cfg] of Object.entries(map)) {
        const sid = String(id || '').trim();
        if (!sid) continue;
        nextMap[sid] = normalizeAccountConfig(cfg, accountFallbackConfig);
    }
    globalConfig.accountConfigs = nextMap;

    // runtimeClient 白名单净化
    globalConfig.runtimeClient = {
        ...getRuntimeClientConfig(),
        // 存盘时不强制写入 client_version（登录时派生即可），避免重复字段
        device_info: { ...getRuntimeClientConfig().device_info },
    };
}

// 保存全局配置（批量写入优化）
// 立即同步保存（用于进程退出时）
function flushGlobalConfigSync() {
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
        console.error('同步保存配置失败:', e.message);
    }
}

// 保存全局配置（批量写入优化）
function saveGlobalConfig() {
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
            console.error('保存配置失败:', e.message);
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

function getAdminPasswordHash() {
    return String(globalConfig.adminPasswordHash || '');
}

function setAdminPasswordHash(hash) {
    globalConfig.adminPasswordHash = String(hash || '');
    saveGlobalConfig();
    return globalConfig.adminPasswordHash;
}

function getDisablePasswordAuth() {
    return Boolean(globalConfig.disablePasswordAuth);
}

function setDisablePasswordAuth(disabled) {
    globalConfig.disablePasswordAuth = Boolean(disabled);
    saveGlobalConfig();
    return globalConfig.disablePasswordAuth;
}

// 初始化加载
loadGlobalConfig();

function getAutomation(accountId) {
    const { validateAutomation } = require('../utils/config-schema');
    const automation = getAccountConfigSnapshot(accountId).automation;
    return validateAutomation(automation);
}

function getConfigSnapshot(accountId) {
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

function applyConfigSnapshot(snapshot, options = {}) {
    const cfg = snapshot || {};
    const persist = options.persist !== false;
    const accountId = options.accountId;

    const current = getAccountConfigSnapshot(accountId);
    const next = validateAccountConfig(cfg, current);

    if (cfg.ui && typeof cfg.ui === 'object') {
        const theme = String(cfg.ui.theme || '').toLowerCase();
        if (theme === 'dark' || theme === 'light') {
            globalConfig.ui.theme = theme;
        }
    }

    setAccountConfigSnapshot(accountId, next, false);
    if (persist) saveGlobalConfig();
    return getConfigSnapshot(accountId);
}

function setAutomation(key, value, accountId) {
    return applyConfigSnapshot({ automation: { [key]: value } }, { accountId });
}

function isAutomationOn(key, accountId) {
    return !!getAccountConfigSnapshot(accountId).automation[key];
}

function getPreferredSeed(accountId) {
    return getAccountConfigSnapshot(accountId).preferredSeedId;
}

function getPlantingStrategy(accountId) {
    return getAccountConfigSnapshot(accountId).plantingStrategy;
}

function getBagSeedPriority(accountId) {
    return [...(getAccountConfigSnapshot(accountId).bagSeedPriority || [])];
}

function setPlantingStrategy(accountId, strategy) {
    const { ALLOWED_VALUES } = require('../utils/config-schema');
    if (!ALLOWED_VALUES.plantingStrategy.has(strategy)) return false;
    applyConfigSnapshot({ plantingStrategy: strategy }, { accountId });
    return true;
}

function getIntervals(accountId) {
    return { ...getAccountConfigSnapshot(accountId).intervals };
}

function normalizeIntervals(intervals) {
    const { validateIntervals: schemaValidateIntervals } = require('../utils/config-schema');
    return schemaValidateIntervals(intervals);
}

function getFriendBlockLevel(accountId) {
    return { ...getAccountConfigSnapshot(accountId).friendBlockLevel };
}

function getFriendQuietHours(accountId) {
    return { ...getAccountConfigSnapshot(accountId).friendQuietHours };
}

function getFriendBlacklist(accountId) {
    return [...(getAccountConfigSnapshot(accountId).friendBlacklist || [])];
}

function setFriendBlacklist(accountId, list) {
    const current = getAccountConfigSnapshot(accountId);
    const next = normalizeAccountConfig(current, accountFallbackConfig);
    next.friendBlacklist = Array.isArray(list) ? list.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
    setAccountConfigSnapshot(accountId, next);
    return [...next.friendBlacklist];
}

function getFriendCache(accountId) {
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

function setFriendCache(accountId, list) {
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

function updateFriendCache(accountId, newItems) {
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

function getUI() {
    return { ...globalConfig.ui };
}

function setUITheme(theme) {
    const t = String(theme || '').toLowerCase();
    const next = (t === 'light') ? 'light' : 'dark';
    return applyConfigSnapshot({ ui: { theme: next } });
}

function getOfflineReminder() {
    return normalizeOfflineReminder(globalConfig.offlineReminder);
}

function setOfflineReminder(cfg) {
    const current = normalizeOfflineReminder(globalConfig.offlineReminder);
    globalConfig.offlineReminder = normalizeOfflineReminder({ ...current, ...(cfg || {}) });
    saveGlobalConfig();
    return getOfflineReminder();
}


function getQrLoginConfig() {
    return normalizeQrLoginConfig(globalConfig.qrLogin);
}

function setQrLoginConfig(cfg) {
    const current = normalizeQrLoginConfig(globalConfig.qrLogin);
    globalConfig.qrLogin = normalizeQrLoginConfig({ ...current, ...(cfg || {}) });
    saveGlobalConfig();
    return getQrLoginConfig();
}
// ============ 账号管理 ============
function loadAccounts() {
    ensureDataDir();
    const data = readJsonFile(ACCOUNTS_FILE, () => ({ accounts: [], nextId: 1 }));
    return normalizeAccountsData(data);
}

function saveAccounts(data) {
    ensureDataDir();
    writeJsonFileAtomic(ACCOUNTS_FILE, normalizeAccountsData(data));
}

function getAccounts() {
    return loadAccounts();
}

function normalizeAccountsData(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const maxId = accounts.reduce((m, a) => Math.max(m, Number.parseInt(a && a.id, 10) || 0), 0);
    let nextId = Number.parseInt(data.nextId, 10);
    if (!Number.isFinite(nextId) || nextId <= 0) nextId = maxId + 1;
    if (accounts.length === 0) nextId = 1;
    if (nextId <= maxId) nextId = maxId + 1;
    return { accounts, nextId };
}

function addOrUpdateAccount(acc) {
    const data = normalizeAccountsData(loadAccounts());
    let touchedAccountId = '';
    if (acc.id) {
        const idx = data.accounts.findIndex(a => a.id === acc.id);
        if (idx >= 0) {
            data.accounts[idx] = { ...data.accounts[idx], ...acc, name: acc.name !== undefined ? acc.name : data.accounts[idx].name, updatedAt: Date.now() };
            touchedAccountId = String(data.accounts[idx].id || '');
        }
    } else {
        const id = data.nextId++;
        touchedAccountId = String(id);
        const defaultName = String(
            acc.name
            || acc.nick
            || (acc.gid ? `GID:${acc.gid}` : '')
            || '',
        ).trim() || `账号${id}`;
        data.accounts.push({
            id: touchedAccountId,
            name: defaultName,
            code: acc.code || '',
            platform: acc.platform || 'qq',
            gid: acc.gid ? String(acc.gid) : '',
            openId: acc.openId ? String(acc.openId) : '',
            uin: acc.uin ? String(acc.uin) : '',
            qq: acc.qq ? String(acc.qq) : (acc.uin ? String(acc.uin) : ''),
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

function deleteAccount(id) {
    const data = normalizeAccountsData(loadAccounts());
    data.accounts = data.accounts.filter(a => a.id !== String(id));
    if (data.accounts.length === 0) {
        data.nextId = 1;
    }
    saveAccounts(data);
    removeAccountConfig(id);
    return data;
}

module.exports = {
    getConfigSnapshot,
    applyConfigSnapshot,
    getAutomation,
    setAutomation,
    isAutomationOn,
    getPreferredSeed,
    getPlantingStrategy,
    getBagSeedPriority,
    setPlantingStrategy,
    getIntervals,
    getFriendBlockLevel,
    getFriendQuietHours,
    getFriendBlacklist,
    setFriendBlacklist,
    getFriendCache,
    setFriendCache,
    updateFriendCache,
    getUI,
    setUITheme,
    getOfflineReminder,
    setOfflineReminder,
    getQrLoginConfig,
    setQrLoginConfig,
    getRuntimeClientConfig,
    setRuntimeClientConfig,
    getAccounts,
    addOrUpdateAccount,
    deleteAccount,
    getAdminPasswordHash,
    setAdminPasswordHash,
    getDisablePasswordAuth,
    setDisablePasswordAuth,
};
