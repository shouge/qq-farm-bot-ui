import type {
  Account,
  AccountsData,
  AutomationConfig,
  FriendBlockLevelConfig,
  FriendQuietHoursConfig,
  FullConfigSnapshot,
  IAccountRepository,
  IConfigRepository,
  IntervalConfig,
  OfflineReminderConfig,
  QrLoginConfig,
  RuntimeClientConfig,
  UIPreferences,
} from '../../domain/ports';
import type { PlantingStrategy } from '../../domain/value-objects/PlantingStrategy';
import {
  addOrUpdateAccount as storeAddOrUpdateAccount,
  applyConfigSnapshot as storeApplyConfigSnapshot,
  deleteAccount as storeDeleteAccount,
  getAccounts as storeGetAccounts,
  getAutomation as storeGetAutomation,
  getConfigSnapshot as storeGetConfigSnapshot,
  getFriendBlacklist as storeGetFriendBlacklist,
  getFriendBlockLevel as storeGetFriendBlockLevel,
  getFriendQuietHours as storeGetFriendQuietHours,
  getIntervals as storeGetIntervals,
  getOfflineReminder as storeGetOfflineReminder,
  getPlantingStrategy as storeGetPlantingStrategy,
  getPreferredSeed as storeGetPreferredSeed,
  getQrLoginConfig as storeGetQrLoginConfig,
  getRuntimeClientConfig as storeGetRuntimeClientConfig,
  getUI as storeGetUI,
  isAutomationOn as storeIsAutomationOn,
  setAutomation as storeSetAutomation,
  setOfflineReminder as storeSetOfflineReminder,
  setQrLoginConfig as storeSetQrLoginConfig,
  setRuntimeClientConfig as storeSetRuntimeClientConfig,
  setUITheme as storeSetUITheme,
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
