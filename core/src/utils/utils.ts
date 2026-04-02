/**
 * 通用工具函数
 */

import Long from 'long';
import { createModuleLogger, sanitizeMeta } from '../services/logger';

const coreLogger = createModuleLogger('core');

// ============ 服务器时间状态 ============
let serverTimeMs = 0;
let localTimeAtSync = 0;

// ============ 类型转换 ============
export function toLong(val: number | Long): Long {
  return Long.fromNumber(typeof val === 'number' ? val : val.toNumber());
}

export function toNum(val: unknown): number {
  if (val && typeof val === 'object') {
    if (Long.isLong(val)) return val.toNumber();
    if ('toNumber' in val && typeof val.toNumber === 'function') {
      return val.toNumber();
    }
  }
  return (val as number) || 0;
}

// ============ 时间相关 ============
export function now(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** 获取当前推算的服务器时间(秒) */
export function getServerTimeSec(): number {
  if (!serverTimeMs) return Math.floor(Date.now() / 1000);
  const elapsed = Date.now() - localTimeAtSync;
  return Math.floor((serverTimeMs + elapsed) / 1000);
}

/** 同步服务器时间 */
export function syncServerTime(ms: number): void {
  serverTimeMs = ms;
  localTimeAtSync = Date.now();
}

/**
 * 将时间戳归一化为秒级
 * 大于 1e12 认为是毫秒级，转换为秒级
 */
export function toTimeSec(val: unknown): number {
  const n = toNum(val);
  if (n <= 0) return 0;
  if (n > 1e12) return Math.floor(n / 1000);
  return n;
}

// ============ 日志 ============
let logHook: ((tag: string, msg: string, isWarn: boolean, meta: Record<string, unknown>) => void) | null = null;

export function setLogHook(hook: typeof logHook): void {
  logHook = hook;
}

function normalizeMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return sanitizeMeta(meta) as Record<string, unknown>;
}

function resolveModuleTag(moduleName: string): string {
  const moduleMap: Record<string, string> = {
    farm: '农场',
    friend: '好友',
    warehouse: '仓库',
    task: '任务',
    system: '系统',
  };
  const m = String(moduleName || '').trim();
  return moduleMap[m] || '系统';
}

function inferModuleFromTag(tag: string): string {
  const t = String(tag || '').trim();
  const tagMap: Record<string, string> = {
    '农场': 'farm',
    '商店': 'warehouse',
    '购买': 'warehouse',
    '仓库': 'warehouse',
    '好友': 'friend',
    '任务': 'task',
    '活跃': 'task',
    '系统': 'system',
    '错误': 'system',
    'WS': 'system',
    '心跳': 'system',
    '推送': 'system',
  };
  return tagMap[t] || 'system';
}

interface LogArgs {
  tag: string;
  msg: string;
  meta: Record<string, unknown> | null;
}

function normalizeLogArgs(arg1: unknown, arg2: unknown, arg3: unknown = null): LogArgs {
  if (typeof arg2 !== 'string') {
    return {
      tag: '',
      msg: String(arg1 || ''),
      meta: arg2 as Record<string, unknown> | null,
    };
  }
  return {
    tag: String(arg1 || ''),
    msg: String(arg2 || ''),
    meta: arg3 as Record<string, unknown> | null,
  };
}

export function log(arg1: unknown, arg2: unknown, arg3: unknown = null): void {
  const { tag, msg, meta } = normalizeLogArgs(arg1, arg2, arg3);
  const safeMeta = normalizeMeta(meta);
  if (!safeMeta.module) safeMeta.module = inferModuleFromTag(tag);
  const displayTag = resolveModuleTag(safeMeta.module as string);
  coreLogger.info(msg, { tag: displayTag, ...safeMeta });
  if (logHook) {
    try { logHook(displayTag, msg, false, safeMeta); } catch { /* ignore */ }
  }
}

export function logWarn(arg1: unknown, arg2: unknown, arg3: unknown = null): void {
  const { tag, msg, meta } = normalizeLogArgs(arg1, arg2, arg3);
  const safeMeta = normalizeMeta(meta);
  if (!safeMeta.module) safeMeta.module = inferModuleFromTag(tag);
  const displayTag = resolveModuleTag(safeMeta.module as string);
  coreLogger.warn(msg, { tag: displayTag, ...safeMeta });
  if (logHook) {
    try { logHook(displayTag, msg, true, safeMeta); } catch { /* ignore */ }
  }
}

// ============ 异步工具 ============
export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
