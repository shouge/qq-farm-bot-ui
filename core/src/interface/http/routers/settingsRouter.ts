import { Router } from 'express';
import { SettingsController } from '../controllers/SettingsController';
import type { IConfigRepository } from '../../../domain/ports/IConfigRepository';

export function createSettingsRouter(configRepo: IConfigRepository): Router {
  const router = Router();
  const ctrl = new SettingsController(configRepo);

  router.get('/settings', ctrl.getSettings);
  router.post('/settings/save', ctrl.saveSettings);
  router.post('/settings/theme', ctrl.setTheme);
  router.post('/settings/offline-reminder', ctrl.setOfflineReminder);
  router.post('/settings/qr-login', ctrl.setQrLogin);
  router.post('/settings/runtime-client', ctrl.setRuntimeClient);
  router.post('/settings/offline-reminder/test', ctrl.testOfflineReminder);

  return router;
}
