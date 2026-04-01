import type {
  Account,
  AccountsData,
  IAccountRepository,
  IConfigRepository,
  FullConfigSnapshot,
  AutomationConfig,
  IntervalConfig,
  FriendBlockLevelConfig,
  FriendQuietHoursConfig,
  UIPreferences,
  OfflineReminderConfig,
  QrLoginConfig,
  RuntimeClientConfig,
} from '../../domain/ports';
import type { PlantingStrategy } from '../../domain/value-objects/PlantingStrategy';
import {
  getAccounts as storeGetAccounts,
  addOrUpdateAccount as storeAddOrUpdateAccount,
  deleteAccount as storeDeleteAccount,
  getAutomation as storeGetAutomation,
  getPlantingStrategy as storeGetPlantingStrategy,
  getPreferredSeed as storeGetPreferredSeed,
  getIntervals as storeGetIntervals,
  getFriendBlockLevel as storeGetFriendBlockLevel,
  getFriendQuietHours as storeGetFriendQuietHours,
  getFriendBlacklist as storeGetFriendBlacklist,
  getConfigSnapshot as storeGetConfigSnapshot,
  applyConfigSnapshot as storeApplyConfigSnapshot,
  setAutomation as storeSetAutomation,
  isAutomationOn as storeIsAutomationOn,
  getUI as storeGetUI,
  setUITheme as storeSetUITheme,
  getOfflineReminder as storeGetOfflineReminder,
  setOfflineReminder as storeSetOfflineReminder,
  getQrLoginConfig as storeGetQrLoginConfig,
  setQrLoginConfig as storeSetQrLoginConfig,
  getRuntimeClientConfig as storeGetRuntimeClientConfig,
  setRuntimeClientConfig as storeSetRuntimeClientConfig,
} from '../../models/store';

export class JsonAccountRepository implements IAccountRepository, IConfigRepository {
  getAccounts(): AccountsData {
    return storeGetAccounts();
  }

  findById(id: string): Account | undefined {
    const data = this.getAccounts();
    return data.accounts.find((a) => a.id === id);
  }

  addOrUpdate(account: Partial<Account> & { id?: string }): AccountsData {
    return storeAddOrUpdateAccount(account);
  }

  delete(id: string): AccountsData {
    return storeDeleteAccount(id);
  }

  // IConfigRepository implementations
  getAutomation(accountId?: string): AutomationConfig {
    return storeGetAutomation(accountId);
  }

  getPlantingStrategy(accountId?: string): PlantingStrategy {
    return storeGetPlantingStrategy(accountId) as PlantingStrategy;
  }

  getPreferredSeedId(accountId?: string): number {
    return storeGetPreferredSeed(accountId);
  }

  getBagSeedPriority(accountId?: string): any {
    const { getBagSeedPriority: storeGetBagSeedPriority } = require('../../models/store');
    return storeGetBagSeedPriority(accountId);
  }

  getIntervals(accountId?: string): IntervalConfig {
    return storeGetIntervals(accountId);
  }

  getFriendBlockLevel(accountId?: string): FriendBlockLevelConfig {
    return storeGetFriendBlockLevel(accountId);
  }

  getFriendQuietHours(accountId?: string): FriendQuietHoursConfig {
    return storeGetFriendQuietHours(accountId);
  }

  getFriendBlacklist(accountId?: string): number[] {
    return storeGetFriendBlacklist(accountId);
  }

  getFriendCache(accountId?: string): any[] {
    const { getFriendCache: storeGetFriendCache } = require('../../models/store');
    return storeGetFriendCache(accountId);
  }

  setFriendCache(accountId: string, list: any[]): any[] {
    const { setFriendCache: storeSetFriendCache } = require('../../models/store');
    return storeSetFriendCache(accountId, list);
  }

  updateFriendCache(accountId: string, friends: any[]): any[] {
    const { updateFriendCache: storeUpdateFriendCache } = require('../../models/store');
    return storeUpdateFriendCache(accountId, friends);
  }

  getConfigSnapshot(accountId?: string): FullConfigSnapshot {
    return storeGetConfigSnapshot(accountId) as FullConfigSnapshot;
  }

  applyConfigSnapshot(snapshot: Partial<FullConfigSnapshot>, accountId?: string): void {
    storeApplyConfigSnapshot(snapshot, { accountId, persist: true });
  }

  setAutomation(key: string, value: unknown, accountId?: string): void {
    storeSetAutomation(key, value, accountId);
  }

  isAutomationOn(key: string, accountId?: string): boolean {
    return storeIsAutomationOn(key, accountId);
  }

  getUI(): UIPreferences {
    return storeGetUI();
  }

  setUITheme(theme: string): UIPreferences {
    return storeSetUITheme(theme);
  }

  getOfflineReminder(): OfflineReminderConfig {
    return storeGetOfflineReminder();
  }

  setOfflineReminder(cfg: Partial<OfflineReminderConfig>): OfflineReminderConfig {
    return storeSetOfflineReminder(cfg);
  }

  getQrLoginConfig(): QrLoginConfig {
    return storeGetQrLoginConfig();
  }

  setQrLoginConfig(cfg: Partial<QrLoginConfig>): QrLoginConfig {
    return storeSetQrLoginConfig(cfg);
  }

  getRuntimeClientConfig(): RuntimeClientConfig {
    return storeGetRuntimeClientConfig();
  }

  setRuntimeClientConfig(cfg: Partial<RuntimeClientConfig>): RuntimeClientConfig {
    return storeSetRuntimeClientConfig(cfg);
  }
}
