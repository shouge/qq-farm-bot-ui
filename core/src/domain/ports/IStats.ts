/**
 * 统计服务端口接口
 */

/** 操作类型 */
export type OperationType =
  | 'harvest'
  | 'water'
  | 'weed'
  | 'bug'
  | 'fertilize'
  | 'plant'
  | 'steal'
  | 'helpWater'
  | 'helpWeed'
  | 'helpBug'
  | 'taskClaim'
  | 'sell'
  | 'upgrade'
  | 'levelUp';

/** 操作计数记录 */
export interface OperationsRecord {
  harvest: number;
  water: number;
  weed: number;
  bug: number;
  fertilize: number;
  plant: number;
  steal: number;
  helpWater: number;
  helpWeed: number;
  helpBug: number;
  taskClaim: number;
  sell: number;
  upgrade: number;
  levelUp: number;
}

/** 统计结果 */
export interface StatsResult {
  connection: { connected: boolean };
  status: {
    name?: string;
    level: number;
    gold: number;
    coupon: number;
    exp: number;
    platform: string;
  };
  uptime: number;
  operations: OperationsRecord;
  sessionExpGained: number;
  sessionGoldGained: number;
  sessionCouponGained: number;
  lastExpGain: number;
  lastGoldGain: number;
  limits?: unknown;
}

/** 用户状态数据 */
export interface UserStateData {
  name?: string;
  level?: number;
  gold?: number;
  exp?: number;
  coupon?: number;
  platform?: string;
}

/** 状态数据 */
export interface StatusData {
  name?: string;
  level?: number;
  gold?: number;
  exp?: number;
  coupon?: number;
  platform?: string;
}

/**
 * 统计服务接口
 */
export interface IStats {
  /** 记录操作次数 */
  recordOperation(type: OperationType, count?: number): void;

  /** 初始化统计状态 */
  initStats(gold: number, exp: number, coupon?: number): void;

  /** 更新统计数据 */
  updateStats(currentGold: number, currentExp: number): void;

  /** 获取统计信息 */
  getStats(
    statusData: StatusData | null | undefined,
    userState: UserStateData | null | undefined,
    connected: boolean,
    limits?: unknown
  ): StatsResult;

  /** 重置会话收益 */
  resetSessionGains(): void;
}
