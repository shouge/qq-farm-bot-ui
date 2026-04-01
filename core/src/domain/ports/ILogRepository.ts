export interface LogQueryOptions {
  limit?: number;
  tag?: string;
  module?: string;
  event?: string;
  keyword?: string;
  isWarn?: string | boolean;
  timeFrom?: string;
  timeTo?: string;
  before?: number | null;
  after?: number | null;
  enablePagination?: boolean;
}

export interface PaginatedLogs {
  data: any[];
  hasMore: boolean;
  nextCursor: number | null;
}

export interface ILogRepository {
  getLogs(accountId: string, options: LogQueryOptions): any[] | PaginatedLogs;
  clearLogs(accountId: string): any;
  getAccountLogs(limit?: number): any[];
}
