import process from 'node:process';
import path from 'node:path';
import { AdminServer } from '../interface/http/AdminServer';
import { RuntimeEngine } from '../infrastructure/runtime/RuntimeEngine';
import { JsonAccountRepository } from '../infrastructure/persistence/JsonAccountRepository';
import { createAuthRouter } from '../interface/http/routers/authRouter';
import { createAdminRouter } from '../interface/http/routers/adminRouter';
import { createAccountRouter } from '../interface/http/routers/accountRouter';
import { createFarmRouter } from '../interface/http/routers/farmRouter';
import { createSettingsRouter } from '../interface/http/routers/settingsRouter';
import { createFriendRouter } from '../interface/http/routers/friendRouter';
import { createInventoryRouter } from '../interface/http/routers/inventoryRouter';
import { createLogRouter } from '../interface/http/routers/logRouter';
import { createQrRouter } from '../interface/http/routers/qrRouter';
import { CONFIG } from '../config/config';
import { enableHotReload } from '../config/gameConfig';
import { createModuleLogger } from '../services/logger';
import * as store from '../models/store';

export interface BridgedRuntime {
  start(options?: { startAdminServer?: boolean; autoStartAccounts?: boolean }): Promise<void>;
  stopAllAccounts(): void;
}

export function createBridgedRuntime(options: { mainEntryPath: string }): BridgedRuntime {
  const mainLogger = createModuleLogger('main');

  const configRepo = new JsonAccountRepository();

  const { router: authRouter, controller: authController } = createAuthRouter(
    () => store.getAdminPasswordHash(),
    () => store.getDisablePasswordAuth(),
    (hash: string) => store.setAdminPasswordHash(hash),
    (disabled: boolean) => store.setDisablePasswordAuth(disabled)
  );

  const adminServer = new AdminServer({
    authRouter,
    adminRouter: null as any,
    accountRouter: null as any,
    farmRouter: null as any,
    settingsRouter: null as any,
    friendRouter: null as any,
    inventoryRouter: null as any,
    logRouter: null as any,
    qrRouter: null as any,
    authController,
    panelDataProvider: null as any,
  });

  const workerScriptPath = require.resolve(path.join(__dirname, '../interface/worker/WorkerEntry'));

  const runtimeEngine = new RuntimeEngine({
    adminServer,
    mainEntryPath: options.mainEntryPath,
    workerScriptPath,
  });

  const panelProvider = runtimeEngine.getPanelDataProvider();

  const adminRouter = createAdminRouter(panelProvider, configRepo, configRepo);
  const accountRouter = createAccountRouter(configRepo, panelProvider, configRepo);
  const farmRouter = createFarmRouter(panelProvider);
  const settingsRouter = createSettingsRouter(configRepo);
  const friendRouter = createFriendRouter(panelProvider);
  const inventoryRouter = createInventoryRouter(panelProvider);
  const logRouter = createLogRouter(panelProvider);
  const qrRouter = createQrRouter(configRepo);

  // Mutate adminServer deps after construction (simpler than forward-declaring all routers)
  (adminServer as any).deps = {
    authRouter,
    adminRouter,
    accountRouter,
    farmRouter,
    settingsRouter,
    friendRouter,
    inventoryRouter,
    logRouter,
    qrRouter,
    authController,
    panelDataProvider: panelProvider,
  };

  return {
    async start(opts = {}) {
      await runtimeEngine.start(opts);
      if (process.env.NODE_ENV === 'development' || process.env.FARM_HOT_RELOAD === '1') {
        enableHotReload(true);
      }
    },
    stopAllAccounts() {
      runtimeEngine.stopAllAccounts();
    },
  };
}
