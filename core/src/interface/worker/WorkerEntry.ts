import { resolveAccountId, WorkerIpcAdapter } from '../../infrastructure/ipc/WorkerIpcAdapter';
import { TypedEventEmitter } from '../../infrastructure/event-bus/TypedEventEmitter';
import { TimeWheelScheduler } from '../../infrastructure/scheduler/TimeWheelScheduler';
import { WsNetworkClient } from '../../infrastructure/network/WsNetworkClient';
import { WinstonLoggerFactory } from '../../infrastructure/logger/WinstonLogger';
import { JsonAccountRepository } from '../../infrastructure/persistence/JsonAccountRepository';
import {
  BotLifecycleService,
  ConfigSynchronizer,
  FarmService,
  FriendService,
  DailyRoutineOrchestrator,
  TickScheduler,
  StatusReporter,
  PlantingOrchestrator,
  FertilizerService,
} from '../../application/services';
import { WorkerMessageDispatcher } from './WorkerMessageDispatcher';
import { HighestLevelStrategy } from '../../application/strategies';
import { setLogHook } from '../../utils/utils';
import { setRecordGoldExpHook } from '../../services/status';
import { recordGoldExp } from '../../services/stats';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatLocalDateTime24(date = new Date()): string {
  const d = date instanceof Date ? date : new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

async function main(): Promise<void> {
  const accountId = resolveAccountId();
  const loggerFactory = new WinstonLoggerFactory();
  const logger = loggerFactory.create('worker');

  const eventBus = new TypedEventEmitter();
  const scheduler = new TimeWheelScheduler('worker');
  const network = new WsNetworkClient(eventBus, scheduler);
  const configRepo = new JsonAccountRepository();
  const ipc = new WorkerIpcAdapter();

  // 捕获日志发送给主进程
  setLogHook((tag: string, msg: string, isWarn: boolean, meta?: any) => {
    ipc.send({
      type: 'log',
      data: {
        time: formatLocalDateTime24(new Date()),
        tag,
        msg,
        isWarn,
        meta: meta || {},
      },
    });
  });

  // 捕获金币经验变化
  setRecordGoldExpHook((gold: number, exp: number) => {
    recordGoldExp(gold, exp);
    ipc.send({ type: 'stat_update', data: { gold, exp } });
  });

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

  const dispatcher = new WorkerMessageDispatcher(bot, configSync, farmService, friendService, ipc, logger);

  ipc.onMessage(async (msg) => {
    await dispatcher.dispatch(msg);
  });
}

main().catch((err) => {
  console.error('Worker entry failed:', err);
  process.exit(1);
});
