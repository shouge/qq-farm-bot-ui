import type { NextFunction, Request, Response } from 'express';

const tokens = new Set<string>();

export function issueToken(): string {
  const crypto = require('node:crypto');
  const token = crypto.randomBytes(24).toString('hex');
  tokens.add(token);
  return token;
}

export function revokeToken(token: string): void {
  tokens.delete(token);
}

export function hasToken(token: string): boolean {
  return tokens.has(token);
}

export function clearTokens(): void {
  tokens.clear();
}

export function authMiddleware(disablePasswordAuthFn?: () => boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (disablePasswordAuthFn && disablePasswordAuthFn()) {
      next();
      return;
    }
    const token = req.headers['x-admin-token'];
    if (!token || typeof token !== 'string' || !tokens.has(token)) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    (req as any).adminToken = token;
    next();
  };
}
