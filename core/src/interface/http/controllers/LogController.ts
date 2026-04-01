import type { Request, Response } from 'express';
import type { ILogRepository, LogQueryOptions } from '../../../domain/ports/ILogRepository';

function resolveAccId(req: Request): string {
  return String(req.headers['x-account-id'] || '').trim();
}

export class LogController {
  constructor(private readonly logRepo: ILogRepository) {}

  getLogs = (req: Request, res: Response): void => {
    try {
      const queryAccountIdRaw = String(req.query.accountId || '').trim();
      const id = queryAccountIdRaw ? (queryAccountIdRaw === 'all' ? '' : queryAccountIdRaw) : resolveAccId(req);
      const enablePagination = !!(req.query.before || req.query.after);
      const options: LogQueryOptions = {
        limit: Number(req.query.limit) || 100,
        tag: String(req.query.tag || ''),
        module: String(req.query.module || ''),
        event: String(req.query.event || ''),
        keyword: String(req.query.keyword || ''),
        isWarn: req.query.isWarn as string | boolean | undefined,
        timeFrom: String(req.query.timeFrom || ''),
        timeTo: String(req.query.timeTo || ''),
        before: req.query.before ? Number(req.query.before) : null,
        after: req.query.after ? Number(req.query.after) : null,
        enablePagination,
      };
      const result = this.logRepo.getLogs(id, options);
      if (enablePagination && result && typeof result === 'object' && !Array.isArray(result) && 'data' in result) {
        const paginated = result as { data?: any[]; hasMore?: boolean; nextCursor?: number | null };
        res.json({
          ok: true,
          data: paginated.data || [],
          hasMore: !!paginated.hasMore,
          nextCursor: paginated.nextCursor || null,
        });
      } else {
        res.json({ ok: true, data: Array.isArray(result) ? result : [] });
      }
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  clearLogs = (req: Request, res: Response): void => {
    try {
      const id = resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const data = this.logRepo.clearLogs(id);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getAccountLogs = (req: Request, res: Response): void => {
    try {
      const limit = Number(req.query.limit) || 100;
      const list = this.logRepo.getAccountLogs(limit);
      res.json(Array.isArray(list) ? list : []);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };
}
