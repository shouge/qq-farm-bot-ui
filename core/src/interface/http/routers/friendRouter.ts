import { Router } from 'express';
import { FriendController } from '../controllers/FriendController';
import type { IPanelDataProvider } from '../../../domain/ports/IPanelDataProvider';

export function createFriendRouter(provider: IPanelDataProvider): Router {
  const router = Router();
  const ctrl = new FriendController(provider);

  router.get('/friends', ctrl.getFriends);
  router.get('/interact-records', ctrl.getInteractRecords);
  router.get('/friend/:gid/lands', ctrl.getFriendLands);
  router.post('/friend/:gid/op', ctrl.doFriendOp);
  router.get('/friend-blacklist', ctrl.getFriendBlacklist);
  router.post('/friend-blacklist/toggle', ctrl.toggleFriendBlacklist);
  router.get('/friend-cache', ctrl.getFriendCache);
  router.post('/friend-cache/update-from-visitors', ctrl.updateFriendCacheFromVisitors);
  router.post('/friend-cache/import-gids', ctrl.importFriendCacheGids);
  router.delete('/friend-cache/:gid', ctrl.deleteFriendCacheGid);

  return router;
}
