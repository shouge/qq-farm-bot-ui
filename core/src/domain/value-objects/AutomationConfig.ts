export type FertilizerMode = 'none' | 'normal' | 'organic' | 'both';
export type FertilizerBuyType = 'organic' | 'normal';
export type FertilizerBuyMode = 'threshold' | 'always';

export interface AutomationConfig {
  farm: boolean;
  farm_manage: boolean;
  farm_water: boolean;
  farm_weed: boolean;
  farm_bug: boolean;
  farm_push: boolean;
  land_upgrade: boolean;
  friend: boolean;
  friend_help_exp_limit: boolean;
  friend_steal: boolean;
  friend_steal_blacklist: number[];
  friend_help: boolean;
  friend_bad: boolean;
  task: boolean;
  email: boolean;
  fertilizer_gift: boolean;
  fertilizer_buy: boolean;
  fertilizer_buy_type: FertilizerBuyType;
  fertilizer_buy_max: number;
  fertilizer_buy_mode: FertilizerBuyMode;
  fertilizer_buy_threshold: number;
  free_gifts: boolean;
  share_reward: boolean;
  vip_gift: boolean;
  month_card: boolean;
  open_server_gift: boolean;
  sell: boolean;
  fertilizer: FertilizerMode;
  fertilizer_multi_season: boolean;
  fertilizer_land_types: string[];
}

export const defaultAutomationConfig: AutomationConfig = {
  farm: true,
  farm_manage: true,
  farm_water: true,
  farm_weed: true,
  farm_bug: true,
  farm_push: true,
  land_upgrade: true,
  friend: true,
  friend_help_exp_limit: true,
  friend_steal: true,
  friend_steal_blacklist: [],
  friend_help: true,
  friend_bad: false,
  task: true,
  email: true,
  fertilizer_gift: false,
  fertilizer_buy: false,
  fertilizer_buy_type: 'organic',
  fertilizer_buy_max: 10,
  fertilizer_buy_mode: 'threshold',
  fertilizer_buy_threshold: 100,
  free_gifts: true,
  share_reward: true,
  vip_gift: true,
  month_card: true,
  open_server_gift: true,
  sell: false,
  fertilizer: 'none',
  fertilizer_multi_season: false,
  fertilizer_land_types: ['gold', 'black', 'red', 'normal'],
};
