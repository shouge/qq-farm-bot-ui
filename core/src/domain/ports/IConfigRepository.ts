import type { AutomationConfig } from '../value-objects/AutomationConfig';
import type { PlantingStrategy } from '../value-objects/PlantingStrategy';

export interface IntervalConfig {
  farm: number;
  friend: number;
  farmMin: number;
  farmMax: number;
  friendMin: number;
  friendMax: number;
}

export interface FriendBlockLevelConfig {
  enabled: boolean;
  Level: number;
}

export interface FriendQuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
}

export interface OfflineReminderConfig {
  channel: string;
  reloginUrlMode: string;
  endpoint: string;
  token: string;
  title: string;
  msg: string;
  offlineDeleteSec: number;
  offlineDeleteEnabled: boolean;
  custom_headers: string;
  custom_body: string;
}

export interface QrLoginConfig {
  apiDomain: string;
}

export interface RuntimeClientConfig {
  serverUrl: string;
  clientVersion: string;
  os: string;
  device_info: {
    client_version?: string;
    sys_software: string;
    network: string;
    memory: string;
    device_id: string;
  };
}

export interface UIPreferences {
  theme: 'dark' | 'light';
}

export interface FullConfigSnapshot {
  automation: AutomationConfig;
  plantingStrategy: PlantingStrategy;
  preferredSeedId: number;
  intervals: IntervalConfig;
  friendBlockLevel: FriendBlockLevelConfig;
  friendQuietHours: FriendQuietHoursConfig;
  friendBlacklist: number[];
  ui: UIPreferences;
  qrLogin: QrLoginConfig;
  runtimeClient: RuntimeClientConfig;
}

export interface IConfigRepository {
  getAutomation(accountId?: string): AutomationConfig;
  getPlantingStrategy(accountId?: string): PlantingStrategy;
  getPreferredSeedId(accountId?: string): number;
  getBagSeedPriority(accountId?: string): any;
  getIntervals(accountId?: string): IntervalConfig;
  getFriendBlockLevel(accountId?: string): FriendBlockLevelConfig;
  getFriendQuietHours(accountId?: string): FriendQuietHoursConfig;
  getFriendBlacklist(accountId?: string): number[];
  getFriendCache(accountId?: string): any[];
  setFriendCache(accountId: string, list: any[]): any[];
  updateFriendCache(accountId: string, friends: any[]): any[];
  getConfigSnapshot(accountId?: string): FullConfigSnapshot;
  applyConfigSnapshot(snapshot: Partial<FullConfigSnapshot>, accountId?: string): void;
  setAutomation(key: string, value: unknown, accountId?: string): void;
  isAutomationOn(key: string, accountId?: string): boolean;

  getUI(): UIPreferences;
  setUITheme(theme: string): UIPreferences;

  getOfflineReminder(): OfflineReminderConfig;
  setOfflineReminder(cfg: Partial<OfflineReminderConfig>): OfflineReminderConfig;

  getQrLoginConfig(): QrLoginConfig;
  setQrLoginConfig(cfg: Partial<QrLoginConfig>): QrLoginConfig;

  getRuntimeClientConfig(): RuntimeClientConfig;
  setRuntimeClientConfig(cfg: Partial<RuntimeClientConfig>): RuntimeClientConfig;
}
