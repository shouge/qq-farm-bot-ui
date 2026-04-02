// Game Item IDs
export enum ItemId {
  COUPON = 1002,           // 点券
  NORMAL_FERTILIZER = 1011, // 普通化肥
  ORGANIC_FERTILIZER = 1012, // 有机肥
}

// Land/Farm operation types
export enum FarmOperationType {
  HARVEST = 'harvest',
  WATER = 'water',
  WEED = 'weed',
  BUG = 'bug',
  FERTILIZE = 'fertilize',
  PLANT = 'plant',
  STEAL = 'steal',
  HELP_WATER = 'helpWater',
  HELP_WEED = 'helpWeed',
  HELP_BUG = 'helpBug',
  TASK_CLAIM = 'taskClaim',
  SELL = 'sell',
  UPGRADE = 'upgrade',
}

// Friend operation types
export enum FriendOperationType {
  STEAL = 'steal',
  WATER = 'water',
  WEED = 'weed',
  BUG = 'bug',
  BAD = 'bad',
}

// Land types for fertilizer selection
export enum LandType {
  NORMAL = 'normal',
  RED = 'red',
  BLACK = 'black',
  GOLD = 'gold',
}

// Worker/Process message types
export enum WorkerMessageType {
  START = 'start',
  STOP = 'stop',
  CONFIG_SYNC = 'config_sync',
  API_CALL = 'api_call',
  API_RESPONSE = 'api_response',
  STATUS_SYNC = 'status_sync',
  LOG = 'log',
  ERROR = 'error',
  WS_ERROR = 'ws_error',
  ACCOUNT_KICKED = 'account_kicked',
  FRIEND_BLACKLIST_ADD = 'friend_blacklist_add',
}

// Account log action types
export enum AccountLogAction {
  START_FAILED = 'start_failed',
  UPDATE = 'update',
  ADD = 'add',
  OFFLINE_DELETE = 'offline_delete',
  KICKOUT_STOP = 'kickout_stop',
  WS_400 = 'ws_400',
}

// Automation feature flags
export enum AutomationFeature {
  FARM_MANAGE = 'farm_manage',
  FARM_WATER = 'farm_water',
  FARM_WEED = 'farm_weed',
  FARM_BUG = 'farm_bug',
  LAND_UPGRADE = 'land_upgrade',
  FERTILIZER_MULTI_SEASON = 'fertilizer_multi_season',
  FERTILIZER_GIFT = 'fertilizer_gift',
  FRIEND = 'friend',
  FRIEND_HELP = 'friend_help',
  FRIEND_HELP_EXP_LIMIT = 'friend_help_exp_limit',
  FRIEND_STEAL = 'friend_steal',
  FRIEND_BAD = 'friend_bad',
  SELL = 'sell',
  TASK_CLAIM = 'task_claim',
  DAILY_EMAIL = 'daily_email',
  DAILY_SHARE = 'daily_share',
  DAILY_VIP = 'daily_vip',
  DAILY_MONTH_CARD = 'daily_month_card',
  DAILY_OPEN_SERVER = 'daily_open_server',
  DAILY_FREE_GIFTS = 'daily_free_gifts',
}

// WebSocket error codes
export enum WebSocketErrorCode {
  AUTH_FAILED = 400,
  CONNECTION_REJECTED = 401,
  SERVER_ERROR = 500,
}

// Fertilizer application reasons
export enum FertilizerReason {
  NORMAL = 'normal',
  MULTI_SEASON = 'multi_season',
}

// Event bus event names
export enum EventName {
  WS_ERROR = 'ws_error',
  KICKOUT = 'kickout',
  SELL = 'sell',
  FARM_HARVESTED = 'farmHarvested',
  STATUS_CHANGE = 'status_change',
  CONFIG_CHANGE = 'config_change',
}
