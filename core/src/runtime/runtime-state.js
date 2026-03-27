const EventEmitter = require('node:events');
const { createModuleLogger } = require('../services/logger');

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatLocalDateTime24(date = new Date()) {
    const d = date instanceof Date ? date : new Date();
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function createRuntimeState(options) {
    const {
        store,
        operationKeys = [],
    } = options;

    const workers = {};
    const globalLogs = [];
    const accountLogs = [];
    const accountLogsMap = new Map(); // 按账号分片的日志
    const runtimeEvents = new EventEmitter();
    let configRevision = Date.now();
    const runtimeLogger = createModuleLogger('runtime');

    // 上次发送的配置快照（用于增量更新）
    const lastConfigSnapshot = new Map();
    const MAX_LOGS_PER_ACCOUNT = 500; // 每个账号最多保存 500 条日志

    // 预置默认 operations 模板（冻结，避免意外修改）
    const defaultOpsTemplate = {};
    for (const k of operationKeys) defaultOpsTemplate[k] = 0;
    Object.freeze(defaultOpsTemplate);

    // operations 对象池（限制大小，避免内存无限增长）
    const opsPool = [];
    const MAX_OPS_POOL_SIZE = 10;

    function nextConfigRevision() {
        configRevision += 1;
        return configRevision;
    }

    // 配置字段列表（用于深度比较）
    const CONFIG_FIELDS = [
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

    // 深度比较两个值是否相等
    function deepEqual(a, b) {
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

    // 深拷贝对象
    function deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(deepClone);
        const cloned = {};
        for (const key of Object.keys(obj)) {
            cloned[key] = deepClone(obj[key]);
        }
        return cloned;
    }

    function buildConfigSnapshotForAccount(accountId) {
        return {
            automation: store.getAutomation(accountId),
            plantingStrategy: store.getPlantingStrategy(accountId),
            preferredSeedId: store.getPreferredSeed(accountId),
            intervals: store.getIntervals(accountId),
            friendBlockLevel: store.getFriendBlockLevel(accountId),
            friendQuietHours: store.getFriendQuietHours(accountId),
            friendBlacklist: store.getFriendBlacklist(accountId),
            friendCache: store.getFriendCache(accountId),
            runtimeClient: store.getRuntimeClientConfig ? store.getRuntimeClientConfig() : null,
            __revision: configRevision,
        };
    }

    // 构建配置增量（仅发送变更字段）
    function buildConfigDeltaForAccount(accountId) {
        const accId = String(accountId || '').trim();
        const current = buildConfigSnapshotForAccount(accId);
        const last = lastConfigSnapshot.get(accId);

        // 如果没有上次快照，返回全量
        if (!last) {
            lastConfigSnapshot.set(accId, deepClone(current));
            return current;
        }

        // 计算增量
        const delta = {
            __revision: current.__revision,
            __delta: true,
        };

        let hasChanges = false;
        for (const field of CONFIG_FIELDS) {
            if (!deepEqual(current[field], last[field])) {
                delta[field] = current[field];
                hasChanges = true;
            }
        }

        // 如果没有变更，返回 null
        if (!hasChanges) {
            return null;
        }

        // 保存当前快照
        lastConfigSnapshot.set(accId, deepClone(current));
        return delta;
    }

    // 清除账号的配置快照缓存（账号删除时调用）
    function clearConfigSnapshot(accountId) {
        const accId = String(accountId || '').trim();
        lastConfigSnapshot.delete(accId);
        accountLogsMap.delete(accId);
    }

    function log(tag, msg, extra = {}) {
        const time = formatLocalDateTime24(new Date());
        const level = tag === '错误' ? 'error' : 'info';
        runtimeLogger[level](msg, { tag, ...extra });
        const moduleName = (tag === '系统' || tag === '错误') ? 'system' : '';
        const entry = {
            time,
            tag,
            msg,
            meta: moduleName ? { module: moduleName } : {},
            ts: Date.now(),
            ...extra,
        };
        entry._searchText = `${entry.msg || ''} ${entry.tag || ''} ${JSON.stringify(entry.meta || {})}`.toLowerCase();

        // 写入全局日志
        globalLogs.push(entry);
        if (globalLogs.length > 1000) globalLogs.shift();

        // 写入账号分片日志
        const accountId = String(entry.accountId || '').trim();
        if (accountId) {
            if (!accountLogsMap.has(accountId)) {
                accountLogsMap.set(accountId, []);
            }
            const accountLogList = accountLogsMap.get(accountId);
            accountLogList.push(entry);
            if (accountLogList.length > MAX_LOGS_PER_ACCOUNT) {
                accountLogList.shift();
            }
        }

        runtimeEvents.emit('log', entry);
    }

    // 从账号分片快速获取日志
    function getLogsByAccount(accountId, filters = {}) {
        const accId = String(accountId || '').trim();
        if (!accId) return [];

        const accountLogList = accountLogsMap.get(accId);
        if (!accountLogList) return [];

        return filterLogs(accountLogList, filters);
    }

    function addAccountLog(action, msg, accountId = '', accountName = '', extra = {}) {
        const entry = {
            time: formatLocalDateTime24(new Date()),
            action,
            msg,
            accountId: accountId ? String(accountId) : '',
            accountName: accountName || '',
            ...extra,
        };
        accountLogs.push(entry);
        if (accountLogs.length > 300) accountLogs.shift();
        runtimeEvents.emit('account_log', entry);
    }

    function normalizeStatusForPanel(data, accountId, accountName) {
        const src = (data && typeof data === 'object') ? data : {};
        const srcOps = src.operations;

        // 快速路径：operations 已存在且所有 key 都合法
        if (srcOps && typeof srcOps === 'object') {
            let needsFix = false;
            for (const k of operationKeys) {
                const v = srcOps[k];
                if (v === undefined || v === null || Number.isNaN(Number(v))) {
                    needsFix = true;
                    break;
                }
            }
            // 如果不需要修复，直接复用原对象（避免创建新对象）
            if (!needsFix) {
                return {
                    ...src,
                    accountId,
                    accountName,
                    operations: srcOps,
                };
            }
        }

        // 慢速路径：需要创建新 operations 对象
        // 尝试从对象池获取
        let ops = opsPool.pop() || {};
        // 重置对象
        for (const k of operationKeys) ops[k] = 0;

        // 合并原始值
        if (srcOps && typeof srcOps === 'object') {
            for (const k of operationKeys) {
                const v = srcOps[k];
                if (v !== undefined && v !== null && !Number.isNaN(Number(v))) {
                    ops[k] = Number(v);
                }
            }
        }

        const result = {
            ...src,
            accountId,
            accountName,
            operations: ops,
        };

        return result;
    }

    function buildDefaultOperations() {
        // 返回模板的浅拷贝（避免外部修改影响模板）
        return { ...defaultOpsTemplate };
    }

    function buildDefaultStatus(accountId) {
        return {
            connection: { connected: false },
            status: { name: '', level: 0, gold: 0, exp: 0, platform: 'qq' },
            uptime: 0,
            operations: buildDefaultOperations(),
            sessionExpGained: 0,
            sessionGoldGained: 0,
            sessionCouponGained: 0,
            lastExpGain: 0,
            lastGoldGain: 0,
            limits: {},
            wsError: null,
            automation: store.getAutomation(accountId),
            preferredSeed: store.getPreferredSeed(accountId),
            expProgress: { current: 0, needed: 0, level: 0 },
            configRevision,
            accountId: String(accountId || ''),
        };
    }

    function filterLogs(list, filters = {}) {
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
                // 兼容历史主进程日志：仅有 tag=系统/错误，没有 meta.module
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

    return {
        workers,
        globalLogs,
        accountLogs,
        accountLogsMap,
        runtimeEvents,
        nextConfigRevision,
        buildConfigSnapshotForAccount,
        buildConfigDeltaForAccount,
        clearConfigSnapshot,
        log,
        addAccountLog,
        getLogsByAccount,
        normalizeStatusForPanel,
        buildDefaultStatus,
        filterLogs,
    };
}

module.exports = {
    createRuntimeState,
};
