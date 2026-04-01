export interface SchedulerSnapshot {
  namespace: string;
  createdAt: number;
  taskCount: number;
  tasks: Array<{
    name: string;
    kind: 'timeout' | 'interval';
    delayMs: number;
    createdAt: number;
    nextRunAt: number;
    lastRunAt: number;
    runCount: number;
    running: boolean;
    preventOverlap: boolean;
  }>;
}

export interface IScheduler {
  setTimeout(
    taskName: string,
    delayMs: number,
    taskFn: () => void | Promise<void>,
    options?: { preventOverlap?: boolean }
  ): void;
  setInterval(
    taskName: string,
    intervalMs: number,
    taskFn: () => void | Promise<void>,
    options?: { preventOverlap?: boolean; runImmediately?: boolean }
  ): void;
  clear(taskName: string): boolean;
  clearAll(): void;
  has(taskName: string): boolean;
  getSnapshot(): SchedulerSnapshot;
}
