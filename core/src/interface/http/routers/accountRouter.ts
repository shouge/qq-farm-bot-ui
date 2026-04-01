import { Router } from 'express';
import { AccountController } from '../controllers/AccountController';
import { AdminController } from '../controllers/AdminController';
import type { IAccountRepository } from '../../../domain/ports/IAccountRepository';
import type { IPanelDataProvider } from '../../../domain/ports/IPanelDataProvider';
import type { IConfigRepository } from '../../../domain/ports/IConfigRepository';

export function createAccountRouter(
  repo: IAccountRepository,
  provider: IPanelDataProvider,
  configRepo: IConfigRepository
): Router {
  const router = Router();
  const ctrl = new AccountController(repo, provider);
  const admin = new AdminController(provider, configRepo, repo);

  router.get('/accounts', ctrl.getAccounts);
  router.post('/accounts', ctrl.addOrUpdate);
  router.delete('/accounts/:id', ctrl.deleteAccount);
  router.post('/accounts/:id/start', admin.startAccount);
  router.post('/accounts/:id/stop', admin.stopAccount);
  router.post('/account/remark', admin.setRemark);

  return router;
}
