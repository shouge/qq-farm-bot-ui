import process from 'node:process';

const isWorkerProcess = process.env.FARM_WORKER === '1';

if (isWorkerProcess) {
  import('./interface/worker/WorkerEntry');
} else {
  const { createBridgedRuntime } = require('./di/mainComposition');
  const { createModuleLogger } = require('./services/logger');

  const mainLogger = createModuleLogger('main');

  const runtime = createBridgedRuntime({ mainEntryPath: __filename });
  runtime
    .start({ startAdminServer: true, autoStartAccounts: true })
    .catch((err: unknown) => {
      mainLogger.error('runtime bootstrap failed', {
        error: err && typeof err === 'object' && 'message' in err ? (err as Error).message : String(err),
      });
      process.exit(1);
    });
}
