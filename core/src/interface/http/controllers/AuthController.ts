import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { CONFIG } from '../../../config/config';
import { hashPassword, verifyPassword, recordLoginAttempts, clearLoginAttempts } from '../../../services/security';

export class AuthController {
  private tokens = new Set<string>();

  constructor(
    private readonly getAdminPasswordHash: () => string,
    private readonly getDisablePasswordAuth: () => boolean,
    private readonly setAdminPasswordHash: (hash: string) => void,
    private readonly setDisablePasswordAuth: (disabled: boolean) => void,
    private readonly onLogout?: (token: string) => void
  ) {}

  login = async (req: Request, res: Response): Promise<void> => {
    try {
      recordLoginAttempts(req.ip || '');
    } catch (error: any) {
      res.status(429).json({ ok: false, error: error?.message || 'Too many attempts' });
      return;
    }

    const input = String((req.body || {}).password || '');
    const storedHash = this.getAdminPasswordHash();
    let ok = false;

    if (storedHash) {
      ok = await verifyPassword(input, storedHash);
    } else {
      ok = input === String(CONFIG.adminPassword || '');
    }

    if (!ok) {
      res.status(401).json({ ok: false, error: 'Invalid password' });
      return;
    }

    clearLoginAttempts(req.ip || '');
    const token = crypto.randomBytes(24).toString('hex');
    this.tokens.add(token);
    res.json({ ok: true, data: { token } });
  };

  logout = (req: Request, res: Response): void => {
    const token = req.headers['x-admin-token'];
    if (typeof token === 'string') {
      this.tokens.delete(token);
      if (this.onLogout) this.onLogout(token);
    }
    res.json({ ok: true });
  };

  validate = (req: Request, res: Response): void => {
    if (this.getDisablePasswordAuth()) {
      res.json({ ok: true, data: { valid: true, passwordDisabled: true } });
      return;
    }
    const token = String(req.headers['x-admin-token'] || '').trim();
    const valid = !!token && this.tokens.has(token);
    if (!valid) {
      res.status(401).json({ ok: false, data: { valid: false }, error: 'Unauthorized' });
      return;
    }
    res.json({ ok: true, data: { valid: true, passwordDisabled: false } });
  };

  changePassword = async (req: Request, res: Response): Promise<void> => {
    const body = req.body || {};
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 4) {
      res.status(400).json({ ok: false, error: '新密码长度至少为 4 位' });
      return;
    }
    const storedHash = this.getAdminPasswordHash();
    const ok = storedHash ? await verifyPassword(oldPassword, storedHash) : oldPassword === String(CONFIG.adminPassword || '');
    if (!ok) {
      res.status(400).json({ ok: false, error: '原密码错误' });
      return;
    }
    const nextHash = await hashPassword(newPassword);
    this.setAdminPasswordHash(nextHash);
    res.json({ ok: true });
  };

  getPasswordAuthStatus = (req: Request, res: Response): void => {
    try {
      res.json({ ok: true, data: { disabled: this.getDisablePasswordAuth() } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  togglePasswordAuth = (req: Request, res: Response): void => {
    try {
      const disabled = Boolean((req.body || {}).disabled);
      this.setDisablePasswordAuth(disabled);
      res.json({ ok: true, data: { disabled } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  validateToken(token: string): boolean {
    if (this.getDisablePasswordAuth()) return true;
    return this.tokens.has(token);
  }
}
