import { Router } from 'express';
import { FarmController } from '../controllers/FarmController';
import type { IPanelDataProvider } from '../../../domain/ports/IPanelDataProvider';

export function createFarmRouter(provider: IPanelDataProvider): Router {
  const router = Router();
  const ctrl = new FarmController(provider);

  router.get('/lands', ctrl.getLands);
  router.get('/seeds', ctrl.getSeeds);
  router.post('/farm/operate', ctrl.operate);
  router.post('/farm/land/operate', ctrl.singleLandOperate);

  return router;
}
