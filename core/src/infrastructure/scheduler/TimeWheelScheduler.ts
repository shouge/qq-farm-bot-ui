import type { IScheduler, SchedulerSnapshot } from '../../domain/ports/IScheduler';
import { createScheduler, getSchedulerRegistrySnapshot, stopScheduler } from '../../services/scheduler';
import type { Scheduler } from '../../services/scheduler';

export class TimeWheelScheduler implements IScheduler {
  private readonly scheduler: Scheduler;

  constructor(namespace: string) {
    this.scheduler = createScheduler(namespace) as Scheduler;
  }

  setTimeout(
    taskName: string,
    delayMs: number,
    taskFn: () => void | Promise<void>,
    options?: { preventOverlap?: boolean }
  ): void {
    this.scheduler.setTimeoutTask(taskName, delayMs, taskFn, options);
  }

  setInterval(
    taskName: string,
    intervalMs: number,
    taskFn: () => void | Promise<void>,
    options?: { preventOverlap?: boolean; runImmediately?: boolean }
  ): void {
    this.scheduler.setIntervalTask(taskName, intervalMs, taskFn, options);
  }

  clear(taskName: string): boolean {
    return this.scheduler.clear(taskName);
  }

  clearAll(): void {
    this.scheduler.clearAll();
  }

  has(taskName: string): boolean {
    return this.scheduler.has(taskName);
  }

  getSnapshot(): SchedulerSnapshot {
    const raw = this.scheduler.getSnapshot();
    return {
      namespace: raw.namespace,
      createdAt: raw.createdAt,
      taskCount: raw.taskCount,
      tasks: raw.tasks.map((t: any) => ({
        name: t.name,
        kind: t.kind as 'timeout' | 'interval',
        delayMs: t.delayMs,
        createdAt: t.createdAt,
        nextRunAt: t.nextRunAt,
        lastRunAt: t.lastRunAt,
        runCount: t.runCount,
        running: t.running,
        preventOverlap: t.preventOverlap,
      })),
    };
  }

  destroy(): void {
    stopScheduler(this.scheduler.name);
  }
}

export function getRegistrySnapshot(): SchedulerSnapshot[] {
  const data = getSchedulerRegistrySnapshot();
  return data.schedulers.map((s: any) => ({
    namespace: s.namespace,
    createdAt: s.createdAt,
    taskCount: s.taskCount,
    tasks: s.tasks.map((t: any) => ({
      name: t.name,
      kind: t.kind as 'timeout' | 'interval',
      delayMs: t.delayMs,
      createdAt: t.createdAt,
      nextRunAt: t.nextRunAt,
      lastRunAt: t.lastRunAt,
      runCount: t.runCount,
      running: t.running,
      preventOverlap: t.preventOverlap,
    })),
  }));
}
