import { Router } from 'express';
import { AdminController } from '../controllers/AdminController';
import type { IPanelDataProvider } from '../../../domain/ports/IPanelDataProvider';
import type { IConfigRepository } from '../../../domain/ports/IConfigRepository';
import type { IAccountRepository } from '../../../domain/ports/IAccountRepository';

export function createAdminRouter(
  provider: IPanelDataProvider,
  configRepo: IConfigRepository,
  accountRepo: IAccountRepository
): Router {
  const router = Router();
  const ctrl = new AdminController(provider, configRepo, accountRepo);

  router.get('/status', ctrl.getStatus);
  router.post('/automation', ctrl.setAutomation);
  router.get('/analytics', ctrl.getAnalytics);
  router.get('/scheduler', ctrl.getScheduler);

  return router;
}
