export interface Scheduler {
  name: string;
  setTimeoutTask: (name: string, delayMs: number, task: () => void | Promise<void>, options?: any) => void;
  setIntervalTask: (name: string, intervalMs: number, task: () => void | Promise<void>, options?: any) => void;
  clear: (name: string) => boolean;
  clearAll: () => void;
  has: (name: string) => boolean;
  getSnapshot: () => {
    namespace: string;
    createdAt: number;
    taskCount: number;
    tasks: any[];
  };
}
export function createScheduler(namespace: string): Scheduler;
export function getSchedulerRegistrySnapshot(): { schedulers: any[] };
export function stopScheduler(name: string): void;
