import type { Request, Response } from 'express';
import type { IAccountRepository } from '../../../domain/ports/IAccountRepository';
import type { IPanelDataProvider } from '../../../domain/ports/IPanelDataProvider';

export class AccountController {
  constructor(
    private readonly repo: IAccountRepository,
    private readonly provider?: IPanelDataProvider
  ) {}

  getAccounts = (req: Request, res: Response): void => {
    try {
      const data = this.repo.getAccounts();
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  addOrUpdate = (req: Request, res: Response): void => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const isUpdate = !!body.id;
      const payload = isUpdate ? { ...body } : { ...body };
      let wasRunning = false;

      if (isUpdate && this.provider) {
        wasRunning = this.provider.isAccountRunning(payload.id);
      }

      // Detect remark-only change
      let onlyRemarkChanged = false;
      if (isUpdate) {
        const oldAccount = this.repo.findById(payload.id);
        if (oldAccount) {
          const payloadKeys = Object.keys(payload);
          const onlyIdAndName = payloadKeys.length === 2 && payloadKeys.includes('id') && payloadKeys.includes('name');
          if (onlyIdAndName) {
            onlyRemarkChanged = true;
          }
        }
      }

      const data = this.repo.addOrUpdate(payload);
      const accountId = isUpdate ? String(payload.id) : String((data.accounts.at(-1) || {}).id || '');
      const accountName = payload.name || '';

      if (this.provider) {
        this.provider.addAccountLog(
          isUpdate ? 'update' : 'add',
          isUpdate ? `更新账号: ${accountName || accountId}` : `添加账号: ${accountName || accountId}`,
          accountId,
          accountName
        );
      }

      if (!isUpdate && this.provider) {
        // Auto-start new account
        const newAcc = data.accounts.at(-1);
        if (newAcc) this.provider.startAccount(newAcc.id);
      } else if (wasRunning && !onlyRemarkChanged && this.provider) {
        this.provider.restartAccount(payload.id);
      }

      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };

  deleteAccount = (req: Request, res: Response): void => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const accountList = this.repo.getAccounts().accounts;
      const target = accountList.find((a) => a.id === id);
      if (this.provider) {
        this.provider.stopAccount(id);
        this.provider.addAccountLog('delete', `删除账号: ${target?.name || id}`, id, target?.name || '');
      }
      const data = this.repo.delete(id);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || '' });
    }
  };
}
