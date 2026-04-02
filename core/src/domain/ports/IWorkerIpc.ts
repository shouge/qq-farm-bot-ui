export type WorkerMessage =
  | { type: 'start'; config: { code: string; platform: string } }
  | { type: 'stop' }
  | { type: 'config_sync'; config: Record<string, unknown> }
  | { type: 'api_call'; id: number; method: string; args: unknown[] }
  | { type: 'friend_blacklist_add'; gid: number };

export type MasterMessage =
  | { type: 'status_sync'; data: Record<string, unknown> }
  | { type: 'log'; data: Record<string, unknown> }
  | { type: 'stat_update'; data: { gold: number; exp: number } }
  | { type: 'api_response'; id: number; result?: unknown; error?: string }
  | { type: 'error'; error: string }
  | { type: 'ws_error'; code: number; message: string }
  | { type: 'account_kicked'; reason: string }
  | { type: 'friend_blacklist_add'; gid: number };

export interface IWorkerIpc {
  send: (message: MasterMessage) => void;
  onMessage: (handler: (msg: WorkerMessage) => void | Promise<void>) => void;
}
