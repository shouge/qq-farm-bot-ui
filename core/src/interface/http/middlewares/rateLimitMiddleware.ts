import type { Request, Response, NextFunction } from 'express';

const requestCounts = new Map<string, number[]>();

export function rateLimitMiddleware(options: { windowMs: number; maxRequests: number }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const timestamps = requestCounts.get(key) || [];
    const valid = timestamps.filter((t) => now - t < options.windowMs);
    if (valid.length >= options.maxRequests) {
      res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
      return;
    }
    valid.push(now);
    requestCounts.set(key, valid);
    next();
  };
}
