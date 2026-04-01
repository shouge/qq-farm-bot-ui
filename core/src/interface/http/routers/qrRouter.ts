import { Router } from 'express';
import { QrController } from '../controllers/QrController';
import type { IConfigRepository } from '../../../domain/ports/IConfigRepository';

export function createQrRouter(configRepo: IConfigRepository): Router {
  const router = Router();
  const ctrl = new QrController(configRepo);

  router.post('/qr/create', ctrl.createQr);
  router.post('/qr/check', ctrl.checkQr);

  return router;
}
