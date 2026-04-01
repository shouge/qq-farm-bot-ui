import { Router } from 'express';
import { InventoryController } from '../controllers/InventoryController';
import type { IPanelDataProvider } from '../../../domain/ports/IPanelDataProvider';

export function createInventoryRouter(provider: IPanelDataProvider): Router {
  const router = Router();
  const ctrl = new InventoryController(provider);

  router.get('/bag', ctrl.getBag);
  router.get('/bag/seeds', ctrl.getBagSeeds);
  router.get('/daily-gifts', ctrl.getDailyGifts);

  return router;
}
