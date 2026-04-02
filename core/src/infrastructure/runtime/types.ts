/**
 * Store interface - mirrors the store module exports
 * This allows RuntimeStateService to have typed access to store functions
 */
export interface Store {
  getAutomation(accountId?: string): Record<string, boolean>;
  getPlantingStrategy(accountId?: string): string;
  getPreferredSeed(accountId?: string): number | null;
  getIntervals(accountId?: string): Record<string, number>;
  getFriendBlockLevel(accountId?: string): number;
  getFriendQuietHours(accountId?: string): { start: number; end: number };
  getFriendBlacklist(accountId?: string): number[];
  getFriendCache(accountId?: string): Array<{ gid: number; name: string }>;
  getRuntimeClientConfig?(): Record<string, unknown> | null;
  getAccounts(): { accounts: Account[] };
  addOrUpdateAccount(account: Partial<Account>): { accounts: Account[] };
  deleteAccount(id: string): void;
  setFriendBlacklist?(accountId: string, list: number[]): void;
}

export interface Account {
  id: string;
  name: string;
  code: string;
  platform: string;
  qq?: string;
  uin?: string;
  avatar?: string;
  nick?: string;
}

export interface ConfigSnapshot {
  automation: Record<string, boolean>;
  plantingStrategy: string;
  preferredSeedId: number | null;
  intervals: Record<string, number>;
  friendBlockLevel: number;
  friendQuietHours: { start: number; end: number };
  friendBlacklist: number[];
  friendCache: Array<{ gid: number; name: string }>;
  runtimeClient: Record<string, unknown> | null;
  __revision: number;
}

export interface ConfigDelta extends Partial<ConfigSnapshot> {
  __revision: number;
  __delta: true;
}

export interface LogFilters {
  keyword?: string;
  tag?: string;
  module?: string;
  event?: string;
  isWarn?: boolean | string | number;
  timeFrom?: string | number | Date;
  timeTo?: string | number | Date;
  limit?: number;
  before?: number;
  after?: number;
  enablePagination?: boolean;
}

export interface WorkerStatus {
  connection: { connected: boolean };
  status: {
    name: string;
    level: number;
    gold: number;
    exp: number;
    platform: string;
  };
  uptime: number;
  operations: Record<string, number>;
  sessionExpGained: number;
  sessionGoldGained: number;
  sessionCouponGained: number;
  lastExpGain: number;
  lastGoldGain: number;
  limits: Record<string, unknown>;
  wsError: { code: number; message: string; at: number } | null;
  automation: Record<string, boolean>;
  preferredSeed: number | null;
  expProgress: { current: number; needed: number; level: number };
  configRevision: number;
  accountId: string;
}

export interface RawWorkerStatus {
  operations?: Record<string, number>;
  [key: string]: unknown;
}
