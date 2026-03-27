const { findAccountByRef, normalizeAccountRef, resolveAccountId: resolveAccountIdByList } = require('../services/account-resolver');
const { getSchedulerRegistrySnapshot } = require('../services/scheduler');

function createDataProvider(options) {
    const {
        workers,
        globalLogs,
        accountLogs,
        accountLogsMap,
        store,
        getAccounts,
        callWorkerApi,
        buildDefaultStatus,
        normalizeStatusForPanel,
        filterLogs,
        addAccountLog,
        getLogsByAccount,
        nextConfigRevision,
        broadcastConfigToWorkers,
        startWorker,
        stopWorker,
        restartWorker,
        clearConfigSnapshot,
    } = options;

    function getStoredAccountsList() {
        const data = getAccounts();
        return Array.isArray(data.accounts) ? data.accounts : [];
    }

    function resolveAccountRefId(accountRef) {
        const raw = normalizeAccountRef(accountRef);
        if (!raw) return '';
        const resolved = resolveAccountIdByList(getStoredAccountsList(), raw);
        return resolved || raw;
    }

    function findAccountByAnyRef(accountRef) {
        return findAccountByRef(getStoredAccountsList(), accountRef);
    }

    return {
        resolveAccountId: (accountRef) => resolveAccountRefId(accountRef),

        // 获取指定账号的状态 (如果 accountId 为空，返回概览?)
        getStatus: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) return buildDefaultStatus('');
            const w = workers[accountId];
            if (!w || !w.status) return buildDefaultStatus(accountId);
            return {
                ...buildDefaultStatus(accountId),
                ...normalizeStatusForPanel(w.status, accountId, w.name),
                wsError: w.wsError || null,
            };
        },

        getLogs: (accountRef, optionsOrLimit) => {
            const opts = (typeof optionsOrLimit === 'object' && optionsOrLimit) ? optionsOrLimit : { limit: optionsOrLimit };
            const max = Math.max(1, Number(opts.limit) || 100);
            const rawRef = normalizeAccountRef(accountRef);
            const accountId = resolveAccountRefId(accountRef);

            let logsSource;
            if (!rawRef) {
                logsSource = [...globalLogs];
            } else if (accountId && getLogsByAccount) {
                // 优先使用账号分片（性能更好）
                logsSource = getLogsByAccount(accountId, opts);
            } else {
                if (!accountId) return { data: [], hasMore: false, nextCursor: null };
                const accId = String(accountId || '');
                logsSource = globalLogs.filter(l => String(l.accountId || '') === accId);
            }

            // 应用过滤（如果还没过滤）
            const filteredLogs = rawRef && getLogsByAccount
                ? logsSource
                : filterLogs(logsSource, opts);

            // 处理分页
            const before = opts.before ? Number(opts.before) : null;
            const after = opts.after ? Number(opts.after) : null;

            let result = filteredLogs;
            let hasMore = false;
            let nextCursor = null;

            if (before) {
                // 获取 before 之前的日志（更早的历史）
                result = filteredLogs.filter(l => {
                    const ts = Number(l.ts) || Date.parse(String(l.time || ''));
                    return ts < before;
                });
            } else if (after) {
                // 获取 after 之后的日志（更新的）
                result = filteredLogs.filter(l => {
                    const ts = Number(l.ts) || Date.parse(String(l.time || ''));
                    return ts > after;
                });
            }

            // 检查是否有更多数据
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

            // 兼容旧格式：如果没有分页参数，直接返回数组
            if (!before && !after && !opts.enablePagination) {
                return result;
            }

            return {
                data: result,
                hasMore,
                nextCursor,
            };
        },
        clearLogs: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) {
                throw new Error('Missing x-account-id');
            }
            const accId = String(accountId || '');
            let cleared = 0;

            // 从全局日志中清除
            for (let i = globalLogs.length - 1; i >= 0; i -= 1) {
                if (String((globalLogs[i] && globalLogs[i].accountId) || '') !== accId) continue;
                globalLogs.splice(i, 1);
                cleared += 1;
            }

            // 从账号分片中清除
            if (accountLogsMap && accountLogsMap.has(accId)) {
                const accountLogList = accountLogsMap.get(accId);
                cleared += accountLogList.length;
                accountLogList.length = 0;
            }

            const worker = workers[accId];
            if (worker && Array.isArray(worker.logs)) {
                worker.logs.length = 0;
            }

            return { accountId: accId, cleared };
        },

        getAccountLogs: (limit) => accountLogs.slice(-limit).reverse(),
        addAccountLog: (action, msg, accountId, accountName, extra) => addAccountLog(action, msg, accountId, accountName, extra),

        // 透传方法
        getLands: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getLands'),
        getFriends: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getFriends'),
        getInteractRecords: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getInteractRecords'),
        getFriendBlacklist: async (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) return [];
            const fromStore = store.getFriendBlacklist ? store.getFriendBlacklist(accountId) : [];
            return Array.isArray(fromStore) ? fromStore : [];
        },
        getFriendCache: async (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) return [];
            const fromStore = store.getFriendCache ? store.getFriendCache(accountId) : [];
            return Array.isArray(fromStore) ? fromStore : [];
        },
        extractFriendsFromInteractRecords: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'extractFriendsFromInteractRecords'),
        getFriendLands: (accountRef, gid) => callWorkerApi(resolveAccountRefId(accountRef), 'getFriendLands', gid),
        doFriendOp: (accountRef, gid, opType) => callWorkerApi(resolveAccountRefId(accountRef), 'doFriendOp', gid, opType),
        getBag: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getBag'),
        getBagSeeds: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getBagSeeds'),
        getDailyGifts: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getDailyGiftOverview'),
        getSeeds: (accountRef) => callWorkerApi(resolveAccountRefId(accountRef), 'getSeeds'),

        setAutomation: async (accountRef, key, value) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) {
                throw new Error('Missing x-account-id');
            }
            store.setAutomation(key, value, accountId);
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(accountId);
            return { automation: store.getAutomation(accountId), configRevision: rev };
        },

        doFarmOp: (accountRef, opType) => callWorkerApi(resolveAccountRefId(accountRef), 'doFarmOp', opType),
        doSingleLandOp: (accountRef, payload) => callWorkerApi(resolveAccountRefId(accountRef), 'doSingleLandOp', payload),
        doAnalytics: (accountRef, sortBy) => callWorkerApi(resolveAccountRefId(accountRef), 'getAnalytics', sortBy),
        saveSettings: async (accountRef, payload) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) {
                throw new Error('Missing x-account-id');
            }
            const body = (payload && typeof payload === 'object') ? payload : {};
            const plantingStrategy = (body.plantingStrategy !== undefined) ? body.plantingStrategy : body.strategy;
            const preferredSeedId = (body.preferredSeedId !== undefined) ? body.preferredSeedId : body.seedId;
            const bagSeedPriority = body.bagSeedPriority;
            const snapshot = {
                plantingStrategy,
                preferredSeedId,
                bagSeedPriority,
                intervals: body.intervals,
                friendBlockLevel: body.friendBlockLevel,
                friendQuietHours: body.friendQuietHours,
            };
            store.applyConfigSnapshot(snapshot, { accountId });
            const rev = nextConfigRevision();
            broadcastConfigToWorkers(accountId);
            return {
                strategy: store.getPlantingStrategy(accountId),
                preferredSeed: store.getPreferredSeed(accountId),
                bagSeedPriority: store.getBagSeedPriority(accountId),
                intervals: store.getIntervals(accountId),
                friendBlockLevel: store.getFriendBlockLevel(accountId),
                friendQuietHours: store.getFriendQuietHours(accountId),
                configRevision: rev,
            };
        },

        setUITheme: async (theme) => {
            const snapshot = store.setUITheme(theme);
            return { ui: snapshot.ui || store.getUI() };
        },

        getRuntimeClientConfig: () => {
            return store.getRuntimeClientConfig ? store.getRuntimeClientConfig() : null;
        },

        setRuntimeClientConfig: async (payload) => {
            const body = (payload && typeof payload === 'object') ? payload : {};
            if (store.setRuntimeClientConfig) {
                store.setRuntimeClientConfig(body);
            }
            const rev = nextConfigRevision();
            // 全局配置：广播到所有 worker
            broadcastConfigToWorkers('');
            return { runtimeClient: store.getRuntimeClientConfig ? store.getRuntimeClientConfig() : null, configRevision: rev };
        },

        broadcastConfig: (accountId) => {
            broadcastConfigToWorkers(accountId);
        },

        setRuntimeAccountName: (accountRef, accountName) => {
            const accountId = resolveAccountRefId(accountRef);
            if (!accountId) return;
            const worker = workers[accountId];
            if (worker) {
                worker.name = String(accountName || worker.name || accountId);
            }
        },

        // 账号管理直接操作 store
        getAccounts: () => {
            const data = getAccounts();
            data.accounts.forEach((a) => {
                const worker = workers[a.id];
                a.running = !!worker;
                if (worker && worker.status && worker.status.status && worker.status.status.name) {
                    a.nick = worker.status.status.name;
                }
            });
            return data;
        },

        startAccount: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            startWorker(acc);
            return true;
        },

        stopAccount: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            if (accountId) stopWorker(accountId);
            return true;
        },

        restartAccount: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            const acc = findAccountByAnyRef(accountId || accountRef);
            if (!acc) return false;
            restartWorker(acc);
            return true;
        },

        isAccountRunning: (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            return !!(accountId && workers[accountId]);
        },

        getSchedulerStatus: async (accountRef) => {
            const accountId = resolveAccountRefId(accountRef);
            const runtime = getSchedulerRegistrySnapshot();
            let worker = null;
            let workerError = '';

            if (!accountId) {
                return { accountId: '', runtime, worker, workerError };
            }

            if (!workers[accountId]) {
                return { accountId, runtime, worker, workerError: '账号未运行' };
            }

            try {
                worker = await callWorkerApi(accountId, 'getSchedulers');
            } catch (e) {
                workerError = (e && e.message) ? e.message : String(e || 'unknown');
            }
            return { accountId, runtime, worker, workerError };
        },
    };
}

module.exports = {
    createDataProvider,
};
