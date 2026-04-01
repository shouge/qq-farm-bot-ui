import type { Request, Response } from 'express';
import type { IPanelDataProvider } from '../../../domain/ports/IPanelDataProvider';
import type { IConfigRepository } from '../../../domain/ports/IConfigRepository';
import type { IAccountRepository } from '../../../domain/ports/IAccountRepository';
import { getPlantRankings } from '../../../services/analytics';
import { getLevelExpProgress } from '../../../config/gameConfig';
import { findAccountByRef } from '../../../services/account-resolver';

export class AdminController {
  constructor(
    private readonly provider: IPanelDataProvider,
    private readonly configRepo: IConfigRepository,
    private readonly accountRepo: IAccountRepository
  ) {}

  getStatus = (req: Request, res: Response): void => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      const data = this.provider.getStatus(id);
      if (data && data.status) {
        const { level, exp } = data.status;
        const progress = getLevelExpProgress(level, exp);
        data.levelProgress = progress;
      }
      res.json({ ok: true, data });
    } catch (e: any) {
      res.json({ ok: false, error: e?.message || '' });
    }
  };

  setAutomation = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      if (!id) {
        res.status(400).json({ ok: false, error: 'Missing x-account-id' });
        return;
      }
      let lastData = null;
      for (const [k, v] of Object.entries(req.body || {})) {
        lastData = await this.provider.setAutomation(id, k, v);
      }
      res.json({ ok: true, data: lastData || {} });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getAnalytics = (req: Request, res: Response): void => {
    try {
      const sortBy = String(req.query.sort || 'exp');
      const data = getPlantRankings(sortBy);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  getScheduler = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.resolveAccId(req);
      const data = await this.provider.getSchedulerStatus(id);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  startAccount = (req: Request, res: Response): void => {
    try {
      const ref = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = this.provider.resolveAccountId(ref);
      const ok = this.provider.startAccount(id);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'Account not found' });
        return;
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  stopAccount = (req: Request, res: Response): void => {
    try {
      const ref = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = this.provider.resolveAccountId(ref);
      const ok = this.provider.stopAccount(id);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'Account not found' });
        return;
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  setRemark = (req: Request, res: Response): void => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const rawRef = body.id || body.accountId || body.uin || req.headers['x-account-id'];
      const accountList = this.accountRepo.getAccounts().accounts || [];
      const target = findAccountByRef(accountList, rawRef);
      if (!target || !target.id) {
        res.status(404).json({ ok: false, error: 'Account not found' });
        return;
      }
      const remark = String(body.remark !== undefined ? body.remark : body.name || '').trim();
      if (!remark) {
        res.status(400).json({ ok: false, error: 'Missing remark' });
        return;
      }
      const accountId = String(target.id);
      const data = this.accountRepo.addOrUpdate({ id: accountId, name: remark });
      this.provider.setRuntimeAccountName(accountId, remark);
      this.provider.addAccountLog('update', `更新账号备注: ${remark}`, accountId, remark);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  private resolveAccId(req: Request): string {
    return this.provider.resolveAccountId(String(req.headers['x-account-id'] || '').trim());
  }
}
