export interface WorkerRecord {
  process: any;
  status: any;
  logs: any[];
  requests: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  reqId: number;
  name: string;
  nick?: string;
  stopping: boolean;
  disconnectedSince: number;
  autoDeleteTriggered: boolean;
  wsError: { code: number; message: string; at: number } | null;
}

export interface RuntimeLogEntry {
  time: string;
  tag: string;
  msg: string;
  meta?: any;
  ts: number;
  accountId?: string;
  accountName?: string;
  _searchText?: string;
  isWarn?: boolean;
  [key: string]: any;
}

export interface AccountLogEntry {
  time: string;
  action: string;
  msg: string;
  accountId: string;
  accountName: string;
  [key: string]: any;
}

export interface IRuntimeStateService {
  workers: Record<string, WorkerRecord>;
  globalLogs: RuntimeLogEntry[];
  accountLogs: AccountLogEntry[];
  accountLogsMap: Map<string, AccountLogEntry[]>;

  nextConfigRevision: () => number;
  buildConfigSnapshotForAccount: (accountId: string) => any;
  buildConfigDeltaForAccount: (accountId: string) => any | null;
  clearConfigSnapshot: (accountId: string) => void;

  log: (tag: string, msg: string, extra?: any) => void;
  addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
  getLogsByAccount: (accountId: string, filters?: any) => RuntimeLogEntry[];

  normalizeStatusForPanel: (data: any, accountId: string, accountName: string) => any;
  buildDefaultStatus: (accountId: string) => any;
  buildDefaultOperations: () => Record<string, number>;
  filterLogs: (list: RuntimeLogEntry[], filters?: any) => RuntimeLogEntry[];
}
