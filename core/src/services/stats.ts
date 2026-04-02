/**
 * 统计工具 - 重构版
 * 基于状态变化累加收益，而非依赖初始值快照
 */

import type { IStats } from '../domain/ports/IStats';

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

/** 状态数据 */
export interface StateData {
  gold: number;
  exp: number;
  coupon: number;
}

/** 会话收益统计 */
export interface SessionStats {
  goldGained: number;
  expGained: number;
  couponGained: number;
  lastExpGain: number;
  lastGoldGain: number;
  lastExpTime?: number;
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

// 账号 worker 启动时间（每个 worker 独立）
const workerBootAtMs = Date.now();

// 操作计数
const operations: OperationsRecord = {
  harvest: 0,
  water: 0,
  weed: 0,
  bug: 0,
  fertilize: 0,
  plant: 0,
  steal: 0,
  helpWater: 0,
  helpWeed: 0,
  helpBug: 0,
  taskClaim: 0,
  sell: 0,
  upgrade: 0,
  levelUp: 0,
};

// 状态追踪
const lastState: StateData = {
  gold: -1,
  exp: -1,
  coupon: -1,
};

// 会话初始总量（登录成功时记录）
const initialState: StateData = {
  gold: null as unknown as number,
  exp: null as unknown as number,
  coupon: null as unknown as number,
};

// 本次会话累计收益
const session: SessionStats = {
  goldGained: 0,
  expGained: 0,
  couponGained: 0,
  lastExpGain: 0,
  lastGoldGain: 0,
};

/**
 * 记录操作次数
 * @param type - 操作类型
 * @param count - 操作次数，默认为1
 */
export function recordOperation(type: OperationType, count = 1): void {
  if (operations[type] !== undefined) {
    operations[type] += count;
  }
}

/**
 * 初始化状态 (登录时调用)
 * @param gold - 金币数量
 * @param exp - 经验值
 * @param coupon - 优惠券数量，默认为0
 */
export function initStats(gold: number, exp: number, coupon = 0): void {
  const g = Number.isFinite(Number(gold)) ? Number(gold) : 0;
  const e = Number.isFinite(Number(exp)) ? Number(exp) : 0;
  const c = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
  lastState.gold = g;
  lastState.exp = e;
  lastState.coupon = c;
  initialState.gold = g;
  initialState.exp = e;
  initialState.coupon = c;
}

/**
 * 更新状态并计算增量
 * 只要数值增加，就累加到 sessionGains
 * @param currentGold - 当前金币
 * @param currentExp - 当前经验值
 */
export function updateStats(currentGold: number, currentExp: number): void {
  // 首次初始化
  if (lastState.gold === -1) lastState.gold = currentGold;
  if (lastState.exp === -1) lastState.exp = currentExp;

  // 计算金币增量
  if (currentGold > lastState.gold) {
    const delta = currentGold - lastState.gold;
    session.lastGoldGain = delta;
  } else if (currentGold < lastState.gold) {
    // 消费了金币，不计入收益，但要更新 lastState
    session.lastGoldGain = 0;
  }
  lastState.gold = currentGold;

  // 计算经验增量 (经验通常只增不减)
  if (currentExp > lastState.exp) {
    const delta = currentExp - lastState.exp;

    // 防抖: 如果 1秒内 增加了完全相同的 delta，视为重复包忽略
    const now = Date.now();
    if (delta === session.lastExpGain && (now - (session.lastExpTime || 0) < 1000)) {
      console.warn(`[系统] 忽略重复经验增量 +${delta}`);
    } else {
      session.lastExpGain = delta;
      session.lastExpTime = now;
      console.warn(`[系统] 经验 +${delta} (总计: ${currentExp})`);
    }
  } else {
    session.lastExpGain = 0;
  }
  lastState.exp = currentExp;
}

/**
 * 兼容旧接口，重定向到 updateStats
 * @param gold - 当前金币
 * @param exp - 当前经验值
 */
export function recordGoldExp(gold: number, exp: number): void {
  updateStats(gold, exp);
}

/**
 * 设置初始值（兼容旧接口，重定向到 initStats）
 * @param gold - 金币数量
 * @param exp - 经验值
 * @param coupon - 优惠券数量，默认为0
 */
export function setInitialValues(gold: number, exp: number, coupon = 0): void {
  initStats(gold, exp, coupon);
}

/**
 * 重置会话收益统计
 */
export function resetSessionGains(): void {
  session.goldGained = 0;
  session.expGained = 0;
  session.couponGained = 0;
  session.lastGoldGain = 0;
  session.lastExpGain = 0;
  session.lastExpTime = 0;
}

/**
 * 重新计算会话总收益
 * @param currentGold - 当前金币
 * @param currentExp - 当前经验值
 * @param currentCoupon - 当前优惠券
 */
export function recomputeSessionTotals(
  currentGold: number,
  currentExp: number,
  currentCoupon: number
): void {
  if (initialState.gold === null || initialState.exp === null || initialState.coupon === null) {
    initialState.gold = currentGold;
    initialState.exp = currentExp;
    initialState.coupon = currentCoupon;
  }
  session.goldGained = currentGold - initialState.gold;
  session.expGained = currentExp - initialState.exp;
  session.couponGained = currentCoupon - initialState.coupon;
}

/**
 * 获取统计信息
 * @param statusData - 状态数据
 * @param userState - 用户状态
 * @param connected - 是否已连接
 * @param limits - 操作限制信息
 * @returns 完整的统计结果
 */
export function getStats(
  statusData: StatusData | null | undefined,
  userState: UserStateData | null | undefined,
  connected: boolean,
  limits?: unknown
): StatsResult {
  const statusObj = statusData && typeof statusData === 'object' ? statusData : {};
  const userObj = userState && typeof userState === 'object' ? userState : {};

  // 优先使用 network 层 userState（通常是最新实时值），statusData 仅作为兜底
  const rawGold = userObj.gold ?? statusObj.gold;
  const rawExp = userObj.exp ?? statusObj.exp;
  const rawCoupon = userObj.coupon ?? statusObj.coupon;
  const currentGold = Number.isFinite(Number(rawGold)) ? Number(rawGold) : 0;
  const currentExp = Number.isFinite(Number(rawExp)) ? Number(rawExp) : 0;
  const currentCoupon = Number.isFinite(Number(rawCoupon)) ? Number(rawCoupon) : 0;

  // 仅在连接就绪后统计，避免登录前 0 -> 登录后真实值被误计为收益
  if (connected) {
    // 兜底统计：即使状态钩子漏掉，也会按当前总值差量累计收益
    updateStats(currentGold, currentExp);
    // 会话总增量 = 当前总量 - 初始总量（不依赖具体操作）
    recomputeSessionTotals(currentGold, currentExp, currentCoupon);
  }

  const operationsSnapshot = { ...operations };
  return {
    connection: { connected },
    status: {
      name: userObj.name || statusObj.name,
      level: statusObj.level || userObj.level || 0,
      gold: currentGold,
      coupon: Number.isFinite(Number(userObj.coupon)) ? Number(userObj.coupon) : 0,
      exp: currentExp,
      platform: statusObj.platform || userObj.platform || 'qq',
    },
    uptime: Math.max(0, Math.floor((Date.now() - workerBootAtMs) / 1000)),
    operations: operationsSnapshot,
    sessionExpGained: session.expGained,
    sessionGoldGained: session.goldGained,
    sessionCouponGained: session.couponGained,
    lastExpGain: session.lastExpGain,
    lastGoldGain: session.lastGoldGain,
    limits,
  };
}

/**
 * Stats 服务类实现 IStats 接口
 */
export class StatsService implements IStats {
  recordOperation(type: OperationType, count?: number): void {
    recordOperation(type, count);
  }

  initStats(gold: number, exp: number, coupon?: number): void {
    initStats(gold, exp, coupon);
  }

  updateStats(currentGold: number, currentExp: number): void {
    updateStats(currentGold, currentExp);
  }

  getStats(
    statusData: StatusData | null | undefined,
    userState: UserStateData | null | undefined,
    connected: boolean,
    limits?: unknown
  ): StatsResult {
    return getStats(statusData, userState, connected, limits);
  }

  resetSessionGains(): void {
    resetSessionGains();
  }
}

// 导出单例实例
export const statsService = new StatsService();
