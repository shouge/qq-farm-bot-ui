import { parentPort, workerData } from 'node:worker_threads';
import process from 'node:process';
import type { IWorkerIpc, MasterMessage, WorkerMessage } from '../../domain/ports/IWorkerIpc';
import { onMasterMessage as legacyOnMasterMessage, sendToMaster as legacySendToMaster } from '../../utils/ipc';

export class WorkerIpcAdapter implements IWorkerIpc {
  send(message: MasterMessage): void {
    legacySendToMaster(message as Record<string, unknown>);
  }

  onMessage(handler: (msg: WorkerMessage) => void | Promise<void>): void {
    legacyOnMasterMessage(async (msg: unknown) => {
      await handler(msg as WorkerMessage);
    });
  }
}

export function resolveAccountId(): string {
  if (parentPort && workerData && workerData.accountId) {
    process.env.FARM_ACCOUNT_ID = String(workerData.accountId);
  }
  return String(process.env.FARM_ACCOUNT_ID || '').trim();
}
