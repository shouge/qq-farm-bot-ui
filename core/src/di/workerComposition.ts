import { resolveAccountId, WorkerIpcAdapter } from '../infrastructure/ipc/WorkerIpcAdapter';
import { TypedEventEmitter } from '../infrastructure/event-bus/TypedEventEmitter';
import { TimeWheelScheduler } from '../infrastructure/scheduler/TimeWheelScheduler';
import { WsNetworkClient } from '../infrastructure/network/WsNetworkClient';
import { WinstonLoggerFactory } from '../infrastructure/logger/WinstonLogger';
import { JsonAccountRepository } from '../infrastructure/persistence/JsonAccountRepository';
import {
  BotLifecycleService,
  ConfigSynchronizer,
  DailyRoutineOrchestrator,
  FarmService,
  FertilizerService,
  FriendService,
  PlantingOrchestrator,
  StatusReporter,
  TickScheduler,
} from '../application/services';
import { WorkerMessageDispatcher } from '../interface/worker/WorkerMessageDispatcher';
import { HighestLevelStrategy } from '../application/strategies';

export function createWorkerDispatcher(): WorkerMessageDispatcher {
  const _accountId = resolveAccountId();
  const loggerFactory = new WinstonLoggerFactory();
  const logger = loggerFactory.create('worker');

  const eventBus = new TypedEventEmitter();
  const scheduler = new TimeWheelScheduler('worker');
  const network = new WsNetworkClient(eventBus, scheduler);
  const configRepo = new JsonAccountRepository();
  const ipc = new WorkerIpcAdapter();

  const plantingOrchestrator = new PlantingOrchestrator(network, new HighestLevelStrategy(), logger);
  const fertilizerService = new FertilizerService(network, scheduler, logger);
  const farmService = new FarmService(network, configRepo, scheduler, logger, eventBus, plantingOrchestrator, fertilizerService);
  const friendService = new FriendService(network, configRepo, scheduler, logger);
  const dailyRoutine = new DailyRoutineOrchestrator([], logger);
  const tickScheduler = new TickScheduler(scheduler, farmService, friendService, configRepo, logger);
  const statusReporter = new StatusReporter(network, configRepo, ipc);
  const configSync = new ConfigSynchronizer(configRepo, network, scheduler, logger, () => {
    network.reconnect();
  });
  const bot = new BotLifecycleService(
    network,
    farmService,
    friendService,
    dailyRoutine,
    tickScheduler,
    configSync,
    statusReporter,
    eventBus,
    ipc,
    logger
  );

  return new WorkerMessageDispatcher(bot, configSync, farmService, friendService, ipc, logger);
}
