import { getServerTimeSec, toNum } from '../../utils/utils';

export interface OperationLimit {
  id: number;
  day_times: number;
  day_times_lt: number;
  day_exp_times: number;
  day_ex_times_lt: number;
}

export interface LimitData {
  dayTimes: number;
  dayTimesLimit: number;
  dayExpTimes: number;
  dayExpTimesLimit: number;
}

export class FriendOperationLimiter {
  private readonly operationLimits = new Map<number, LimitData>();
  private lastResetDate = '';
  private canGetHelpExp = true;
  private helpAutoDisabledByLimit = false;

  checkDailyReset(): void {
    const nowSec = getServerTimeSec();
    const nowMs = nowSec > 0 ? nowSec * 1000 : Date.now();
    const bjOffset = 8 * 3600 * 1000;
    const bjDate = new Date(nowMs + bjOffset);
    const y = bjDate.getUTCFullYear();
    const m = String(bjDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(bjDate.getUTCDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;

    if (this.lastResetDate !== today) {
      this.operationLimits.clear();
      this.canGetHelpExp = true;
      if (this.helpAutoDisabledByLimit) {
        this.helpAutoDisabledByLimit = false;
      }
      this.lastResetDate = today;
    }
  }

  updateLimits(limits: OperationLimit[] | undefined): void {
    if (!limits || limits.length === 0) return;
    this.checkDailyReset();
    for (const limit of limits) {
      const id = toNum(limit.id);
      if (id > 0) {
        this.operationLimits.set(id, {
          dayTimes: toNum(limit.day_times),
          dayTimesLimit: toNum(limit.day_times_lt),
          dayExpTimes: toNum(limit.day_exp_times),
          dayExpTimesLimit: toNum(limit.day_ex_times_lt),
        });
      }
    }
  }

  canOperate(opId: number): boolean {
    const limit = this.operationLimits.get(opId);
    if (!limit) return true;
    if (limit.dayTimesLimit <= 0) return true;
    return limit.dayTimes < limit.dayTimesLimit;
  }

  canGetExp(opId: number): boolean {
    const limit = this.operationLimits.get(opId);
    if (!limit) return false;
    if (limit.dayExpTimesLimit <= 0) return true;
    return limit.dayExpTimes < limit.dayExpTimesLimit;
  }

  getRemainingTimes(opId: number): number {
    const limit = this.operationLimits.get(opId);
    if (!limit || limit.dayTimesLimit <= 0) return 999;
    return Math.max(0, limit.dayTimesLimit - limit.dayTimes);
  }

  getLimits(): Record<number, LimitData & { name: string; remaining: number }> {
    const result: Record<number, LimitData & { name: string; remaining: number }> = {};
    const OP_NAMES: Record<number, string> = {
      10001: '收获',
      10002: '铲除',
      10003: '放草',
      10004: '放虫',
      10005: '除草',
      10006: '除虫',
      10007: '浇水',
      10008: '偷菜',
    };
    for (const id of Object.keys(OP_NAMES).map(Number)) {
      const limit = this.operationLimits.get(id);
      if (limit) {
        result[id] = {
          ...limit,
          name: OP_NAMES[id],
          remaining: this.getRemainingTimes(id),
        };
      }
    }
    return result;
  }

  autoDisableHelpByExpLimit(): void {
    if (!this.canGetHelpExp) return;
    this.canGetHelpExp = false;
    this.helpAutoDisabledByLimit = true;
  }

  isHelpEnabled(stopWhenExpLimit: boolean): boolean {
    if (!stopWhenExpLimit) return true;
    return this.canGetHelpExp;
  }
}
