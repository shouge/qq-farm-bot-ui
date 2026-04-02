import { createModuleLogger } from './logger';

const schedulerLogger = createModuleLogger('scheduler');

// 默认配置
export const DEFAULT_CONFIG = {
  tickMs: 100,
  wheelSize: 60,
  maxDelay: 86400000,
  enableStats: true,
};

// 全局调度器注册表
const schedulerRegistry = new Map<string, Scheduler>();

export interface TimerNodeOptions {
  preventOverlap?: boolean;
  runImmediately?: boolean;
  kind?: 'timeout' | 'interval';
}

/**
 * 时间轮任务节点
 */
export class TimerNode {
  taskName: string;
  delayMs: number;
  taskFn: () => void | Promise<void>;
  options: Required<TimerNodeOptions>;
  executeAt: number;
  runCount = 0;
  lastRunAt = 0;
  running = false;
  next: TimerNode | null = null;
  kind: string;
  createdAt: number;

  constructor(
    taskName: string,
    delayMs: number,
    taskFn: () => void | Promise<void>,
    options: TimerNodeOptions = {},
  ) {
    this.taskName = taskName;
    this.delayMs = delayMs;
    this.taskFn = taskFn;
    this.options = {
      preventOverlap: options.preventOverlap !== false,
      runImmediately: options.runImmediately || false,
      kind: options.kind || 'timeout',
    };

    this.executeAt = Date.now() + delayMs;
    this.kind = options.kind || 'timeout';
    this.createdAt = Date.now();
  }
}

interface TaskIndexEntry {
  bucketIndex: number;
  node: TimerNode;
}

/**
 * 时间轮 - 用于高效调度大量定时任务
 */
export class TimeWheel {
  size: number;
  buckets: TimerNode[][];
  currentIndex = 0;
  taskIndex = new Map<string, TaskIndexEntry>();

  constructor(size: number) {
    this.size = size;
    this.buckets = Array.from({ length: size }).map(() => []);
  }

  calculateIndex(executeAt: number): number {
    const tick = Math.floor(executeAt / DEFAULT_CONFIG.tickMs) % this.size;
    return tick;
  }

  add(node: TimerNode): void {
    const index = this.calculateIndex(node.executeAt);
    this.buckets[index].push(node);
    this.taskIndex.set(node.taskName, { bucketIndex: index, node });
  }

  getCurrentTasks(): TimerNode[] {
    const tasks = this.buckets[this.currentIndex];
    this.buckets[this.currentIndex] = [];
    for (const node of tasks) {
      this.taskIndex.delete(node.taskName);
    }
    return tasks;
  }

  tick(): void {
    this.currentIndex = (this.currentIndex + 1) % this.size;
  }

  getPendingCount(): number {
    return this.taskIndex.size;
  }

  remove(taskName: string): boolean {
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

  has(taskName: string): boolean {
    return this.taskIndex.has(taskName);
  }

  getTaskNames(): string[] {
    return Array.from(this.taskIndex.keys());
  }

  clear(): void {
    for (let i = 0; i < this.size; i++) {
      this.buckets[i] = [];
    }
    this.taskIndex.clear();
  }
}

interface SchedulerConfig {
  tickMs?: number;
  wheelSize?: number;
  maxDelay?: number;
  enableStats?: boolean;
}

interface SchedulerStats {
  totalTasksRun: number;
  totalTasksAdded: number;
  totalTasksCancelled: number;
  lastTickAt: number;
  maxPendingTasks: number;
}

interface TimerEntry {
  timer: ReturnType<typeof setTimeout>;
  node: TimerNode;
}

/**
 * 优化版调度器
 */
export class Scheduler {
  name: string;
  config: typeof DEFAULT_CONFIG;
  timers = new Map<string, TimerEntry>();
  timeWheel: TimeWheel;
  tickTimer: ReturnType<typeof setInterval> | null = null;
  running = false;
  stats: SchedulerStats = {
    totalTasksRun: 0,
    totalTasksAdded: 0,
    totalTasksCancelled: 0,
    lastTickAt: 0,
    maxPendingTasks: 0,
  };
  createdAt: number;

  constructor(namespace = 'default', config: SchedulerConfig = {}) {
    this.name = namespace;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.timeWheel = new TimeWheel(this.config.wheelSize);
    this.createdAt = Date.now();
  }

  start(): this {
    if (this.running) return this;

    this.running = true;
    this.tickTimer = setInterval(() => this.tick(), this.config.tickMs);
    schedulerLogger.debug(`调度器已启动: ${this.name}`, { namespace: this.name, tickMs: this.config.tickMs });
    return this;
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    this.clearAll();
    schedulerLogger.debug(`调度器已停止: ${this.name}`, { namespace: this.name });
  }

  tick(): void {
    if (!this.running) return;

    this.stats.lastTickAt = Date.now();
    const tasks = this.timeWheel.getCurrentTasks();

    for (const node of tasks) {
      const now = Date.now();
      if (node.executeAt > now) {
        this.timeWheel.add(node);
        continue;
      }

      this.executeTask(node);
    }

    this.timeWheel.tick();

    const pending = this.timeWheel.getPendingCount() + this.timers.size;
    if (pending > this.stats.maxPendingTasks) {
      this.stats.maxPendingTasks = pending;
    }
  }

  async executeTask(node: TimerNode): Promise<void> {
    const { taskName, taskFn, options } = node;

    if (options.preventOverlap && node.running) {
      schedulerLogger.debug('任务正在运行，重新调度', { taskName, namespace: this.name });
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
    } catch (error: unknown) {
      schedulerLogger.warn(`[${this.name}] 任务执行失败: ${taskName}`, {
        error: error instanceof Error ? error.message : String(error),
        runCount: node.runCount,
      });
    } finally {
      node.running = false;
    }
  }

  scheduleLongDelayTask(node: TimerNode): void {
    const delay = Math.min(node.delayMs, this.config.maxDelay);

    const timer = setTimeout(() => {
      this.timers.delete(node.taskName);
      this.executeTask(node);
    }, delay);

    this.timers.set(node.taskName, { timer, node });
  }

  setTimeoutTask(
    taskName: string,
    delayMs: number,
    taskFn: () => void | Promise<void>,
    options: TimerNodeOptions = {},
  ): TimerNode | undefined {
    const key = String(taskName || '');
    if (!key) throw new Error('taskName 不能为空');
    if (typeof taskFn !== 'function') throw new Error(`timeout 任务 ${key} 缺少回调函数`);

    this.clear(key);

    const delay = Math.max(0, Number(delayMs) || 0);

    if (delay <= 0) {
      this.executeTask(new TimerNode(key, 0, taskFn, { ...options, kind: 'timeout' }));
      return;
    }

    const node = new TimerNode(key, delay, taskFn, { ...options, kind: 'timeout' });
    this.stats.totalTasksAdded++;

    if (delay <= this.config.maxDelay) {
      this.timeWheel.add(node);
    } else {
      this.scheduleLongDelayTask(node);
    }

    return node;
  }

  setIntervalTask(
    taskName: string,
    intervalMs: number,
    taskFn: () => void | Promise<void>,
    options: TimerNodeOptions = {},
  ): TimerNode | undefined {
    const key = String(taskName || '');
    if (!key) throw new Error('taskName 不能为空');
    if (typeof taskFn !== 'function') throw new Error(`interval 任务 ${key} 缺少回调函数`);

    this.clear(key);

    const { runImmediately, preventOverlap } = options;
    const interval = Math.max(1, Number(intervalMs) || 1000);

    if (runImmediately) {
      Promise.resolve().then(taskFn).catch(() => null);
    }

    const intervalTask = async (): Promise<void> => {
      const wrapper = async (): Promise<void> => {
        await taskFn();

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

    return this.setTimeoutTask(key, interval, intervalTask, {
      ...options,
      preventOverlap,
      runImmediately: false,
      kind: 'interval',
    });
  }

  clear(taskName: string): boolean {
    const key = String(taskName || '');
    if (!key) return false;

    let cleared = false;

    const timerEntry = this.timers.get(key);
    if (timerEntry) {
      clearTimeout(timerEntry.timer);
      this.timers.delete(key);
      this.stats.totalTasksCancelled++;
      cleared = true;
    }

    if (this.timeWheel.remove(key)) {
      this.stats.totalTasksCancelled++;
      cleared = true;
    }

    return cleared;
  }

  clearAll(): void {
    for (const { timer } of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.timeWheel.clear();
    this.stats.totalTasksCancelled += this.timeWheel.getPendingCount();
  }

  has(taskName: string): boolean {
    const key = String(taskName || '');
    if (this.timers.has(key)) return true;
    return this.timeWheel.has(key);
  }

  getTaskNames(): string[] {
    const names = [...this.timers.keys()];
    names.push(...this.timeWheel.getTaskNames());
    return [...new Set(names)];
  }

  getSnapshot(): SchedulerSnapshot {
    const tasks: TaskSnapshot[] = [];

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

  getStats(): SchedulerStatsWithPending {
    return {
      ...this.stats,
      pendingTasks: this.timeWheel.getPendingCount() + this.timers.size,
      activeTimers: this.timers.size,
      timeWheelPending: this.timeWheel.getPendingCount(),
    };
  }
}

export interface TaskSnapshot {
  name: string;
  kind: string;
  delayMs: number;
  createdAt: number;
  nextRunAt: number;
  lastRunAt: number;
  runCount: number;
  running: boolean;
  preventOverlap: boolean;
}

interface TaskMeta {
  kind?: string;
  delayMs?: number;
  createdAt?: number;
  nextRunAt?: number;
  lastRunAt?: number;
  runCount?: number;
  running?: boolean;
  preventOverlap?: boolean;
}

function normalizeTaskSnapshot(taskName: string, meta: TaskMeta): TaskSnapshot {
  return {
    name: String(taskName || ''),
    kind: meta.kind || 'timeout',
    delayMs: Math.max(0, Number(meta.delayMs) || 0),
    createdAt: Number(meta.createdAt) || 0,
    nextRunAt: Number(meta.nextRunAt) || 0,
    lastRunAt: Number(meta.lastRunAt) || 0,
    runCount: Number(meta.runCount) || 0,
    running: !!meta.running,
    preventOverlap: meta.preventOverlap !== false,
  };
}

export interface SchedulerSnapshot {
  namespace: string;
  createdAt: number;
  taskCount: number;
  tasks: TaskSnapshot[];
}

export interface SchedulerStatsWithPending extends SchedulerStats {
  pendingTasks: number;
  activeTimers: number;
  timeWheelPending: number;
}

export function createScheduler(namespace = 'default', config: SchedulerConfig = {}): Scheduler {
  const name = String(namespace || 'default');

  if (schedulerRegistry.has(name)) {
    return schedulerRegistry.get(name)!;
  }

  const scheduler = new Scheduler(name, config);
  scheduler.start();
  schedulerRegistry.set(name, scheduler);

  return scheduler;
}

export function getScheduler(namespace: string): Scheduler | undefined {
  return schedulerRegistry.get(String(namespace || ''));
}

export function getSchedulerRegistrySnapshot(namespaceFilter = ''): RegistrySnapshot {
  const ns = String(namespaceFilter || '').trim();
  const list: SchedulerSnapshot[] = [];

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

export interface RegistrySnapshot {
  generatedAt: number;
  schedulerCount: number;
  schedulers: SchedulerSnapshot[];
}

export function stopScheduler(namespace: string): boolean {
  const name = String(namespace || '');
  const scheduler = schedulerRegistry.get(name);
  if (!scheduler) return false;

  scheduler.stop();
  schedulerRegistry.delete(name);
  return true;
}

export function stopAllSchedulers(): void {
  for (const [, scheduler] of schedulerRegistry.entries()) {
    scheduler.stop();
  }
  schedulerRegistry.clear();
}
