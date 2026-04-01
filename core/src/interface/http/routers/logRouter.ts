import { Router } from 'express';
import { LogController } from '../controllers/LogController';
import type { ILogRepository } from '../../../domain/ports/ILogRepository';

export function createLogRouter(logRepo: ILogRepository): Router {
  const router = Router();
  const ctrl = new LogController(logRepo);

  router.get('/logs', ctrl.getLogs);
  router.delete('/logs', ctrl.clearLogs);
  router.get('/account-logs', ctrl.getAccountLogs);

  return router;
}
