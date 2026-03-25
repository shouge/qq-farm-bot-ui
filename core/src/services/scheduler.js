const { createModuleLogger } = require('./logger');

const schedulerLogger = createModuleLogger('scheduler');

// 默认配置
const DEFAULT_CONFIG = {
    tickMs: 100,          // 时钟滴答间隔 (ms)
    wheelSize: 60,        // 时间轮大小
    maxDelay: 86400000,   // 最大延迟 (24小时)
    enableStats: true,    // 启用统计
};

// 全局调度器注册表 (namespace -> scheduler)
const schedulerRegistry = new Map();

/**
 * 时间轮任务节点
 */
class TimerNode {
    constructor(taskName, delayMs, taskFn, options = {}) {
        this.taskName = taskName;
        this.delayMs = delayMs;
        this.taskFn = taskFn;
        this.options = {
            preventOverlap: options.preventOverlap !== false,
            runImmediately: options.runImmediately || false,
            ...options,
        };

        this.executeAt = Date.now() + delayMs;
        this.runCount = 0;
        this.lastRunAt = 0;
        this.running = false;
        this.next = null;

        // 元数据
        this.kind = options.kind || 'timeout';
        this.createdAt = Date.now();
    }
}

/**
 * 时间轮 - 用于高效调度大量定时任务
 * 时间复杂度: 添加 O(1), 删除 O(1), 查找 O(1), 执行 O(1)
 */
class TimeWheel {
    constructor(size) {
        this.size = size;
        this.buckets = Array.from({ length: size }, () => []);
        this.currentIndex = 0;
        // Map 索引: taskName -> { bucketIndex, node }，实现 O(1) 查找
        this.taskIndex = new Map();
    }

    /**
     * 计算任务在时间轮中的索引
     */
    calculateIndex(executeAt) {
        const tick = Math.floor(executeAt / DEFAULT_CONFIG.tickMs) % this.size;
        return tick;
    }

    /**
     * 添加任务到时间轮
     */
    add(node) {
        const index = this.calculateIndex(node.executeAt);
        this.buckets[index].push(node);
        // 更新索引
        this.taskIndex.set(node.taskName, { bucketIndex: index, node });
    }

    /**
     * 获取当前时间槽的任务并清空该槽
     */
    getCurrentTasks() {
        const tasks = this.buckets[this.currentIndex];
        this.buckets[this.currentIndex] = [];
        // 从索引中移除这些任务
        for (const node of tasks) {
            this.taskIndex.delete(node.taskName);
        }
        return tasks;
    }

    /**
     * 推进时间轮
     */
    tick() {
        this.currentIndex = (this.currentIndex + 1) % this.size;
    }

    /**
     * 获取等待执行的任务数
     */
    getPendingCount() {
        return this.taskIndex.size;
    }

    /**
     * 查找并移除指定任务 - O(1)
     */
    remove(taskName) {
        const entry = this.taskIndex.get(taskName);
        if (!entry) return false;

        const { bucketIndex, node } = entry;
        const bucket = this.buckets[bucketIndex];
        const index = bucket.indexOf(node);

        if (index !== -1) {
            bucket.splice(index, 1);
        }
        this.taskIndex.delete(taskName);
        return true;
    }

    /**
     * 检查任务是否存在 - O(1)
     */
    has(taskName) {
        return this.taskIndex.has(taskName);
    }

    /**
     * 获取所有任务名称 - O(n)
     */
    getTaskNames() {
        return Array.from(this.taskIndex.keys());
    }

    /**
     * 清空所有任务
     */
    clear() {
        for (let i = 0; i < this.size; i++) {
            this.buckets[i] = [];
        }
        this.taskIndex.clear();
    }
}

/**
 * 优化版调度器
 * 基于时间轮算法，支持大量任务的高效调度
 */
class Scheduler {
    constructor(namespace = 'default', config = {}) {
        this.name = namespace;
        this.config = { ...DEFAULT_CONFIG, ...config };

        // 命名定时器 (用于长延迟任务或需要精确控制的任务)
        this.timers = new Map();

        // 时间轮 (用于短延迟任务的高效调度)
        this.timeWheel = new TimeWheel(this.config.wheelSize);

        // 时钟滴答定时器
        this.tickTimer = null;
        this.running = false;

        // 统计信息
        this.stats = {
            totalTasksRun: 0,
            totalTasksAdded: 0,
            totalTasksCancelled: 0,
            lastTickAt: 0,
            maxPendingTasks: 0,
        };

        // 启动时间
        this.createdAt = Date.now();
    }

    /**
     * 启动调度器时钟
     */
    start() {
        if (this.running) return this;

        this.running = true;
        this.tickTimer = setInterval(() => this.tick(), this.config.tickMs);
        schedulerLogger.debug(`调度器已启动: ${this.name}`, { namespace: this.name, tickMs: this.config.tickMs });
        return this;
    }

    /**
     * 停止调度器
     */
    stop() {
        if (!this.running) return;

        this.running = false;
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }

        // 清除所有任务
        this.clearAll();

        schedulerLogger.debug(`调度器已停止: ${this.name}`, { namespace: this.name });
    }

    /**
     * 时钟滴答 - 每 tickMs 执行一次
     */
    tick() {
        if (!this.running) return;

        this.stats.lastTickAt = Date.now();

        // 执行当前时间槽的任务
        const tasks = this.timeWheel.getCurrentTasks();

        for (const node of tasks) {
            // 检查是否需要延迟执行（执行时间还未到）
            const now = Date.now();
            if (node.executeAt > now) {
                // 重新放回时间轮
                this.timeWheel.add(node);
                continue;
            }

            this.executeTask(node);
        }

        // 推进时间轮
        this.timeWheel.tick();

        // 更新统计
        const pending = this.timeWheel.getPendingCount() + this.timers.size;
        if (pending > this.stats.maxPendingTasks) {
            this.stats.maxPendingTasks = pending;
        }
    }

    /**
     * 执行任务
     */
    async executeTask(node) {
        const { taskName, taskFn, options } = node;

        // 防重入检查
        if (options.preventOverlap && node.running) {
            schedulerLogger.debug('任务正在运行，重新调度', { taskName, namespace: this.name });
            // 重新调度到下一次
            node.executeAt = Date.now() + this.config.tickMs;
            this.timeWheel.add(node);
            return;
        }

        node.running = true;
        node.runCount++;
        node.lastRunAt = Date.now();

        try {
            await taskFn();
            this.stats.totalTasksRun++;
        } catch (error) {
            schedulerLogger.warn(`[${this.name}] 任务执行失败: ${taskName}`, {
                error: error && error.message ? error.message : String(error),
                runCount: node.runCount,
            });
        } finally {
            node.running = false;
        }
    }

    /**
     * 调度长延迟任务 (超过 maxDelay 的任务)
     */
    scheduleLongDelayTask(node) {
        const delay = Math.min(node.delayMs, this.config.maxDelay);

        // 使用 setTimeout 处理长延迟
        const timer = setTimeout(() => {
            this.timers.delete(node.taskName);
            // 检查是否应该直接执行或加入时间轮
            this.executeTask(node);
        }, delay);

        this.timers.set(node.taskName, { timer, node });
    }

    /**
     * 设置延时任务
     * @param {string} taskName - 任务名称
     * @param {number} delayMs - 延迟时间(毫秒)
     * @param {Function} taskFn - 任务函数
     * @param {Object} options - 选项
     * @returns {TimerNode|undefined}
     */
    setTimeoutTask(taskName, delayMs, taskFn, options = {}) {
        const key = String(taskName || '');
        if (!key) throw new Error('taskName 不能为空');
        if (typeof taskFn !== 'function') throw new Error(`timeout 任务 ${key} 缺少回调函数`);

        // 清除同名任务
        this.clear(key);

        const delay = Math.max(0, Number(delayMs) || 0);

        // 立即执行
        if (delay <= 0) {
            this.executeTask(new TimerNode(key, 0, taskFn, { ...options, kind: 'timeout' }));
            return;
        }

        const node = new TimerNode(key, delay, taskFn, { ...options, kind: 'timeout' });
        this.stats.totalTasksAdded++;

        // 短延迟任务使用时间轮，长延迟任务使用 setTimeout
        if (delay <= this.config.maxDelay) {
            this.timeWheel.add(node);
        } else {
            this.scheduleLongDelayTask(node);
        }

        return node;
    }

    /**
     * 设置间隔任务
     * @param {string} taskName - 任务名称
     * @param {number} intervalMs - 间隔时间(毫秒)
     * @param {Function} taskFn - 任务函数
     * @param {Object} options - 选项
     * @param {boolean} options.preventOverlap - 是否防止重叠执行
     * @param {boolean} options.runImmediately - 是否立即执行
     * @returns {TimerNode|undefined}
     */
    setIntervalTask(taskName, intervalMs, taskFn, options = {}) {
        const key = String(taskName || '');
        if (!key) throw new Error('taskName 不能为空');
        if (typeof taskFn !== 'function') throw new Error(`interval 任务 ${key} 缺少回调函数`);

        // 清除同名任务
        this.clear(key);

        const { runImmediately, preventOverlap } = options;
        const interval = Math.max(1, Number(intervalMs) || 1000);

        // 立即执行一次
        if (runImmediately) {
            Promise.resolve().then(taskFn).catch(() => null);
        }

        // 创建循环执行的任务
        const intervalTask = async () => {
            const wrapper = async () => {
                await taskFn();

                // 重新调度下一次执行
                if (this.running) {
                    this.setTimeoutTask(key, interval, intervalTask, {
                        ...options,
                        preventOverlap,
                        runImmediately: false,
                        kind: 'interval',
                    });
                }
            };

            await wrapper();
        };

        // 启动第一次间隔执行
        return this.setTimeoutTask(key, interval, intervalTask, {
            ...options,
            preventOverlap,
            runImmediately: false,
            kind: 'interval',
        });
    }

    /**
     * 清除指定任务
     * @param {string} taskName - 任务名称
     * @returns {boolean}
     */
    clear(taskName) {
        const key = String(taskName || '');
        if (!key) return false;

        let cleared = false;

        // 从 timers 中移除
        const timerEntry = this.timers.get(key);
        if (timerEntry) {
            clearTimeout(timerEntry.timer);
            this.timers.delete(key);
            this.stats.totalTasksCancelled++;
            cleared = true;
        }

        // 从时间轮中移除
        if (this.timeWheel.remove(key)) {
            this.stats.totalTasksCancelled++;
            cleared = true;
        }

        return cleared;
    }

    /**
     * 清除所有任务
     */
    clearAll() {
        // 清除 timers
        for (const { timer } of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();

        // 清空时间轮
        this.timeWheel.clear();

        this.stats.totalTasksCancelled += this.timeWheel.getPendingCount();
    }

    /**
     * 检查任务是否存在
     * @param {string} taskName - 任务名称
     * @returns {boolean}
     */
    has(taskName) {
        const key = String(taskName || '');
        if (this.timers.has(key)) return true;
        return this.timeWheel.has(key);
    }

    /**
     * 获取所有任务名称列表
     * @returns {string[]}
     */
    getTaskNames() {
        const names = [...this.timers.keys()];
        names.push(...this.timeWheel.getTaskNames());
        return [...new Set(names)];
    }

    /**
     * 获取调度器快照 - O(n)，但只遍历实际任务
     * @returns {Object}
     */
    getSnapshot() {
        const tasks = [];

        // 收集 timers 中的任务
        for (const [name, { node }] of this.timers.entries()) {
            tasks.push(normalizeTaskSnapshot(name, {
                kind: node.kind,
                delayMs: node.delayMs,
                createdAt: node.createdAt,
                nextRunAt: node.executeAt,
                lastRunAt: node.lastRunAt,
                runCount: node.runCount,
                running: node.running,
                preventOverlap: node.options.preventOverlap,
            }));
        }

        // 收集时间轮中的任务 - 直接遍历索引，避免扫描空 bucket
        for (const [name, { node }] of this.timeWheel.taskIndex.entries()) {
            tasks.push(normalizeTaskSnapshot(name, {
                kind: node.kind,
                delayMs: node.delayMs,
                createdAt: node.createdAt,
                nextRunAt: node.executeAt,
                lastRunAt: node.lastRunAt,
                runCount: node.runCount,
                running: node.running,
                preventOverlap: node.options.preventOverlap,
            }));
        }

        tasks.sort((a, b) => a.name.localeCompare(b.name));

        return {
            namespace: this.name,
            createdAt: this.createdAt,
            taskCount: tasks.length,
            tasks,
        };
    }

    /**
     * 获取统计信息
     * @returns {Object}
     */
    getStats() {
        return {
            ...this.stats,
            pendingTasks: this.timeWheel.getPendingCount() + this.timers.size,
            activeTimers: this.timers.size,
            timeWheelPending: this.timeWheel.getPendingCount(),
        };
    }
}

/**
 * 标准化任务快照
 */
function normalizeTaskSnapshot(taskName, meta) {
    const item = meta || {};
    return {
        name: String(taskName || ''),
        kind: item.kind || 'timeout',
        delayMs: Math.max(0, Number(item.delayMs) || 0),
        createdAt: Number(item.createdAt) || 0,
        nextRunAt: Number(item.nextRunAt) || 0,
        lastRunAt: Number(item.lastRunAt) || 0,
        runCount: Number(item.runCount) || 0,
        running: !!item.running,
        preventOverlap: item.preventOverlap !== false,
    };
}

/**
 * 创建或获取调度器实例
 * 相同 namespace 的调度器会被复用
 * @param {string} namespace - 命名空间
 * @param {Object} config - 配置选项
 * @returns {Scheduler}
 */
function createScheduler(namespace = 'default', config = {}) {
    const name = String(namespace || 'default');

    // 如果已存在，返回已注册的调度器
    if (schedulerRegistry.has(name)) {
        return schedulerRegistry.get(name);
    }

    // 创建新调度器
    const scheduler = new Scheduler(name, config);
    scheduler.start();

    // 注册到全局注册表
    schedulerRegistry.set(name, scheduler);

    return scheduler;
}

/**
 * 获取指定命名空间的调度器
 * @param {string} namespace - 命名空间
 * @returns {Scheduler|undefined}
 */
function getScheduler(namespace) {
    return schedulerRegistry.get(String(namespace || ''));
}

/**
 * 获取全局调度器注册表快照
 * @param {string} namespaceFilter - 可选的命名空间过滤器
 * @returns {Object}
 */
function getSchedulerRegistrySnapshot(namespaceFilter = '') {
    const ns = String(namespaceFilter || '').trim();
    const list = [];

    for (const [name, scheduler] of schedulerRegistry.entries()) {
        if (ns && name !== ns) continue;
        list.push(scheduler.getSnapshot());
    }

    list.sort((a, b) => a.namespace.localeCompare(b.namespace));

    return {
        generatedAt: Date.now(),
        schedulerCount: list.length,
        schedulers: list,
    };
}

/**
 * 停止并移除指定调度器
 * @param {string} namespace - 命名空间
 * @returns {boolean}
 */
function stopScheduler(namespace) {
    const name = String(namespace || '');
    const scheduler = schedulerRegistry.get(name);
    if (!scheduler) return false;

    scheduler.stop();
    schedulerRegistry.delete(name);
    return true;
}

/**
 * 停止所有调度器
 */
function stopAllSchedulers() {
    for (const [name, scheduler] of schedulerRegistry.entries()) {
        scheduler.stop();
    }
    schedulerRegistry.clear();
}

module.exports = {
    Scheduler,
    TimeWheel,
    TimerNode,
    createScheduler,
    getScheduler,
    stopScheduler,
    stopAllSchedulers,
    getSchedulerRegistrySnapshot,
    DEFAULT_CONFIG,
};
