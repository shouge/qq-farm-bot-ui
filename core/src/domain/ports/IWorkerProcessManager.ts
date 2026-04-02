export interface IWorkerProcessManager {
  startWorker: (account: any) => boolean;
  stopWorker: (accountId: string) => void;
  restartWorker: (account: any) => void;
  callWorkerApi: (accountId: string, method: string, ...args: any[]) => Promise<any>;
}
