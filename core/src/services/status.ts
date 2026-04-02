/**
 * 状态栏 - 在终端固定位置显示用户状态
 */

import process from 'node:process';
import { getLevelExpTable, getLevelExpProgress } from '../config/gameConfig';
import type { IStatusBar } from '../domain/ports/IStatusBar';

/** 平台类型 */
export type PlatformType = 'qq' | 'wx';

/** 状态数据 */
export interface StatusData {
  platform: PlatformType;
  name: string;
  level: number;
  gold: number;
  exp: number;
}

/** 登录基本信息 */
export interface LoginBasicInfo {
  name?: string;
  level?: number;
  gold?: number;
  exp?: number;
}

/** 状态更新数据 */
export interface StatusUpdateData {
  platform?: PlatformType;
  name?: string;
  level?: number;
  gold?: number;
  exp?: number;
}

// 统计钩子（可选，admin 未加载时为空）
let recordGoldExpHook: ((gold: number, exp: number) => void) | null = null;

/**
 * 设置统计钩子
 * @param hook - 金币经验记录钩子函数
 */
export function setRecordGoldExpHook(hook: (gold: number, exp: number) => void): void {
  recordGoldExpHook = hook;
}

// ============ 状态数据 ============
const statusData: StatusData = {
  platform: 'qq',
  name: '',
  level: 0,
  gold: 0,
  exp: 0,
};

// ============ 状态栏高度 ============
const STATUS_LINES = 2; // 状态栏占用行数

// ============ ANSI 转义码 ============
const ESC = '\x1B';
const SAVE_CURSOR = `${ESC}7`;
const RESTORE_CURSOR = `${ESC}8`;
const MOVE_TO = (row: number, col: number) => `${ESC}[${row};${col}H`;
const CLEAR_LINE = `${ESC}[2K`;
const SCROLL_REGION = (top: number, bottom: number) => `${ESC}[${top};${bottom}r`;
const RESET_SCROLL = `${ESC}[r`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;
const CYAN = `${ESC}[36m`;
const YELLOW = `${ESC}[33m`;
const GREEN = `${ESC}[32m`;
const MAGENTA = `${ESC}[35m`;

// ============ 状态栏是否启用 ============
let statusEnabled = false;
let termRows = 24;

/**
 * 初始化状态栏
 * @returns 是否成功启用
 */
export function initStatusBar(): boolean {
  // 检测终端是否支持
  if (!process.stdout.isTTY) {
    return false;
  }

  termRows = process.stdout.rows || 24;
  statusEnabled = true;

  // 设置滚动区域，留出顶部状态栏空间
  process.stdout.write(SCROLL_REGION(STATUS_LINES + 1, termRows));
  // 移动光标到滚动区域
  process.stdout.write(MOVE_TO(STATUS_LINES + 1, 1));

  // 监听终端大小变化
  process.stdout.on('resize', () => {
    termRows = process.stdout.rows || 24;
    process.stdout.write(SCROLL_REGION(STATUS_LINES + 1, termRows));
    renderStatusBar();
  });

  // 初始渲染
  renderStatusBar();
  return true;
}

/**
 * 清理状态栏（退出时调用）
 */
export function cleanupStatusBar(): void {
  if (!statusEnabled) return;
  statusEnabled = false;
  // 重置滚动区域
  process.stdout.write(RESET_SCROLL);
  // 清除状态栏
  process.stdout.write(MOVE_TO(1, 1) + CLEAR_LINE);
  process.stdout.write(MOVE_TO(2, 1) + CLEAR_LINE);
}

/**
 * 渲染状态栏
 */
export function renderStatusBar(): void {
  if (!statusEnabled) return;

  const { platform, name, level, gold, exp } = statusData;

  // 构建状态行
  const platformStr = platform === 'wx' ? `${MAGENTA}微信${RESET}` : `${CYAN}QQ${RESET}`;
  const nameStr = name ? `${BOLD}${name}${RESET}` : '未登录';
  const levelStr = `${GREEN}Lv${level}${RESET}`;
  const goldStr = `${YELLOW}金币:${gold}${RESET}`;

  // 显示经验值
  let expStr = '';
  if (level > 0 && exp >= 0) {
    const levelExpTable = getLevelExpTable();
    if (levelExpTable) {
      // 有配置表时显示当前等级进度
      const progress = getLevelExpProgress(level, exp);
      expStr = `${DIM}经验:${progress.current}/${progress.needed}${RESET}`;
    } else {
      // 没有配置表时只显示累计经验
      expStr = `${DIM}经验:${exp}${RESET}`;
    }
  }

  // 第一行：平台 | 昵称 | 等级 | 金币 | 经验
  const line1 = `${platformStr} | ${nameStr} | ${levelStr} | ${goldStr}${expStr ? ` | ${expStr}` : ''}`;

  // 第二行：分隔线
  const width = process.stdout.columns || 80;
  const line2 = `${DIM}${'─'.repeat(Math.min(width, 80))}${RESET}`;

  // 保存光标位置
  process.stdout.write(SAVE_CURSOR);
  // 移动到第一行并清除
  process.stdout.write(MOVE_TO(1, 1) + CLEAR_LINE + line1);
  // 移动到第二行并清除
  process.stdout.write(MOVE_TO(2, 1) + CLEAR_LINE + line2);
  // 恢复光标位置
  process.stdout.write(RESTORE_CURSOR);
}

/**
 * 更新状态数据并刷新显示
 * @param data - 要更新的状态数据
 */
export function updateStatus(data: StatusUpdateData): void {
  let changed = false;
  for (const key of Object.keys(data) as Array<keyof StatusUpdateData>) {
    const value = data[key];
    if (value !== undefined && statusData[key] !== value) {
      (statusData[key] as unknown) = value;
      changed = true;
    }
  }
  if (changed) {
    if (statusEnabled) renderStatusBar();
    if (recordGoldExpHook && (data.gold !== undefined || data.exp !== undefined)) {
      try {
        recordGoldExpHook(statusData.gold, statusData.exp);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * 设置平台
 * @param platform - 平台类型
 */
export function setStatusPlatform(platform: PlatformType): void {
  updateStatus({ platform });
}

/**
 * 从登录数据更新状态
 * @param basic - 登录基本信息
 */
export function updateStatusFromLogin(basic: LoginBasicInfo): void {
  updateStatus({
    name: basic.name || statusData.name,
    level: basic.level ?? statusData.level,
    gold: basic.gold ?? statusData.gold,
    exp: basic.exp ?? statusData.exp,
  });
}

/**
 * 更新金币
 * @param gold - 金币数量
 */
export function updateStatusGold(gold: number): void {
  updateStatus({ gold });
}

/**
 * 更新等级和经验
 * @param level - 等级
 * @param exp - 经验值
 */
export function updateStatusLevel(level: number, exp?: number): void {
  const data: StatusUpdateData = { level };
  if (exp !== undefined) data.exp = exp;
  updateStatus(data);
}

/**
 * 获取当前状态数据（只读）
 * @returns 当前状态数据的副本
 */
export function getStatusData(): Readonly<StatusData> {
  return { ...statusData };
}

/**
 * 状态栏服务类实现 IStatusBar 接口
 */
export class StatusBarService implements IStatusBar {
  init(): boolean {
    return initStatusBar();
  }

  cleanup(): void {
    cleanupStatusBar();
  }

  update(data: StatusUpdateData): void {
    updateStatus(data);
  }

  setPlatform(platform: PlatformType): void {
    setStatusPlatform(platform);
  }

  updateFromLogin(basic: LoginBasicInfo): void {
    updateStatusFromLogin(basic);
  }

  updateGold(gold: number): void {
    updateStatusGold(gold);
  }

  updateLevel(level: number, exp?: number): void {
    updateStatusLevel(level, exp);
  }

  getData(): Readonly<StatusData> {
    return getStatusData();
  }
}

// 导出单例实例
export const statusBarService = new StatusBarService();

// 导出原始状态数据对象（兼容旧代码）
export { statusData };
