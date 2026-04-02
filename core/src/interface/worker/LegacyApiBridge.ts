import { extractFriendsFromInteractRecords, getInteractRecords } from '../../services/interact';
import { getBagDetail, getBagSeeds } from '../../services/warehouse';
import { getPlantRankings } from '../../services/analytics';
import { getSchedulerRegistrySnapshot } from '../../services/scheduler';
import {
  getGrowthTaskStateLikeApp,
  getTaskClaimDailyState,
  getTaskDailyStateLikeApp,
} from '../../services/task';
import { getEmailDailyState } from '../../services/email';
import { getFreeGiftDailyState } from '../../services/mall';
import { getVipDailyState } from '../../services/qqvip';
import { getMonthCardDailyState } from '../../services/monthcard';
import { getOpenServerDailyState } from '../../services/openserver';
import { getShareDailyState } from '../../services/share';
import { getAutomation } from '../../models/store';

export async function bridgeLegacyApiCall(method: string, args: unknown[]): Promise<{ result?: unknown; error?: string }> {
  try {
    switch (method) {
      case 'getInteractRecords':
        return { result: await getInteractRecords() };
      case 'extractFriendsFromInteractRecords':
        return { result: await extractFriendsFromInteractRecords() };
      case 'getBag':
        return { result: await getBagDetail() };
      case 'getBagSeeds':
        return { result: await getBagSeeds() };
      case 'getSeeds':
        // Reuse farm service for seeds when available; otherwise return empty
        return { result: { seeds: [] } };
      case 'getAnalytics':
        return { result: getPlantRankings(String(args[0] || 'exp')) };
      case 'getSchedulers':
        return { result: getSchedulerRegistrySnapshot() };
      case 'getDailyGiftOverview':
        return { result: await getDailyGiftOverview() };
      default:
        return { error: 'Unknown method' };
    }
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

async function getDailyGiftOverview(): Promise<any> {
  const auto = getAutomation() || {};
  const task = getTaskDailyStateLikeApp
    ? await getTaskDailyStateLikeApp()
    : (getTaskClaimDailyState ? getTaskClaimDailyState() : { doneToday: false, lastClaimAt: 0 });
  const growthTask = getGrowthTaskStateLikeApp
    ? await getGrowthTaskStateLikeApp()
    : { doneToday: false, completedCount: 0, totalCount: 0, tasks: [] };
  const email = getEmailDailyState ? getEmailDailyState() : { doneToday: false, lastCheckAt: 0 };
  const free = getFreeGiftDailyState ? getFreeGiftDailyState() : { doneToday: false, lastClaimAt: 0 };
  const share = getShareDailyState ? getShareDailyState() : { doneToday: false, lastClaimAt: 0 };
  const vip = getVipDailyState ? getVipDailyState() : { doneToday: false, lastClaimAt: 0 };
  const month = getMonthCardDailyState ? getMonthCardDailyState() : { doneToday: false, lastClaimAt: 0 };
  const openServer = getOpenServerDailyState ? getOpenServerDailyState() : { doneToday: false, lastClaimAt: 0, lastCheckAt: 0 };

  return {
    date: new Date().toISOString().slice(0, 10),
    growth: {
      key: 'growth_task',
      label: '成长任务',
      doneToday: !!growthTask.doneToday,
      completedCount: Number(growthTask.completedCount || 0),
      totalCount: Number(growthTask.totalCount || 0),
      tasks: Array.isArray(growthTask.tasks) ? growthTask.tasks : [],
    },
    gifts: [
      {
        key: 'task_claim',
        label: '每日任务',
        enabled: !!auto.task,
        doneToday: !!task.doneToday,
        lastAt: Number(task.lastClaimAt || 0),
        completedCount: Number((task as any).completedCount || 0),
        totalCount: Number((task as any).totalCount || 3),
      },
      { key: 'email_rewards', label: '邮箱奖励', enabled: !!auto.email, doneToday: !!email.doneToday, lastAt: Number(email.lastCheckAt || 0) },
      { key: 'mall_free_gifts', label: '商城免费礼包', enabled: !!auto.free_gifts, doneToday: !!free.doneToday, lastAt: Number(free.lastClaimAt || 0) },
      { key: 'daily_share', label: '分享礼包', enabled: !!auto.share_reward, doneToday: !!share.doneToday, lastAt: Number(share.lastClaimAt || 0) },
      {
        key: 'vip_daily_gift',
        label: '会员礼包',
        enabled: !!auto.vip_gift,
        doneToday: !!vip.doneToday,
        lastAt: Number(vip.lastClaimAt || (vip as any).lastCheckAt || 0),
        hasGift: Object.hasOwn(vip, 'hasGift') ? !!vip.hasGift : undefined,
        canClaim: Object.hasOwn(vip, 'canClaim') ? !!vip.canClaim : undefined,
        result: (vip as any).result || '',
      },
      {
        key: 'month_card_gift',
        label: '月卡礼包',
        enabled: !!auto.month_card,
        doneToday: !!month.doneToday,
        lastAt: Number(month.lastClaimAt || 0),
      },
      {
        key: 'open_server_gift',
        label: '开服礼包',
        enabled: !!auto.open_server_gift,
        doneToday: !!openServer.doneToday,
        lastAt: Number(openServer.lastClaimAt || openServer.lastCheckAt || 0),
      },
    ],
  };
}
