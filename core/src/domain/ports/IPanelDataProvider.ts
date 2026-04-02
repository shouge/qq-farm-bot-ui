export interface IPanelDataProvider {
  resolveAccountId: (accountRef: string) => string;

  // Status
  getStatus: (accountRef: string) => any;

  // Farm
  getLands: (accountRef: string) => Promise<any>;
  doFarmOp: (accountRef: string, opType: string) => Promise<any>;
  doSingleLandOp: (accountRef: string, payload: any) => Promise<any>;
  getSeeds: (accountRef: string) => Promise<any>;

  // Friend
  getFriends: (accountRef: string) => Promise<any>;
  getInteractRecords: (accountRef: string) => Promise<any>;
  getFriendLands: (accountRef: string, gid: number) => Promise<any>;
  doFriendOp: (accountRef: string, gid: number, opType: string) => Promise<any>;
  getFriendBlacklist: (accountRef: string) => Promise<number[]>;
  setFriendBlacklist: (accountRef: string, list: number[]) => void;
  getFriendCache: (accountRef: string) => Promise<any[]>;
  updateFriendCache: (accountRef: string, friends: any[]) => Promise<any[]>;
  setFriendCache: (accountRef: string, list: any[]) => Promise<any[]>;
  extractFriendsFromInteractRecords: (accountRef: string) => Promise<any>;

  // Inventory / Daily
  getBag: (accountRef: string) => Promise<any>;
  getBagSeeds: (accountRef: string) => Promise<any>;
  getDailyGifts: (accountRef: string) => Promise<any>;

  // Config / Settings
  saveSettings: (accountRef: string, payload: any) => Promise<any>;
  setAutomation: (accountRef: string, key: string, value: unknown) => Promise<any>;
  setUITheme: (theme: string) => Promise<any>;
  getRuntimeClientConfig: () => any;
  setRuntimeClientConfig: (payload: any) => Promise<any>;
  broadcastConfig: (accountId?: string) => void;

  // Analytics / Scheduler
  doAnalytics: (accountRef: string, sortBy: string) => Promise<any>;
  getSchedulerStatus: (accountRef: string) => Promise<any>;

  // Account management
  getAccounts: () => { accounts: any[] };
  startAccount: (accountRef: string) => boolean;
  stopAccount: (accountRef: string) => boolean;
  restartAccount: (accountRef: string) => boolean;
  isAccountRunning: (accountRef: string) => boolean;
  setRuntimeAccountName: (accountRef: string, accountName: string) => void;

  // Logs
  getLogs: (accountRef: string, options?: any) => any[] | { data: any[]; hasMore: boolean; nextCursor: number | null };
  clearLogs: (accountRef: string) => any;
  getAccountLogs: (limit?: number) => any[];
  addAccountLog: (action: string, msg: string, accountId?: string, accountName?: string, extra?: any) => void;
}
