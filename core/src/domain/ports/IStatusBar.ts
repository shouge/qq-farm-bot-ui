/**
 * 状态栏服务端口接口
 */

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

/**
 * 状态栏服务接口
 */
export interface IStatusBar {
  /** 初始化状态栏 */
  init(): boolean;

  /** 清理状态栏 */
  cleanup(): void;

  /** 更新状态数据 */
  update(data: StatusUpdateData): void;

  /** 设置平台 */
  setPlatform(platform: PlatformType): void;

  /** 从登录数据更新状态 */
  updateFromLogin(basic: LoginBasicInfo): void;

  /** 更新金币 */
  updateGold(gold: number): void;

  /** 更新等级和经验 */
  updateLevel(level: number, exp?: number): void;

  /** 获取当前状态数据 */
  getData(): Readonly<StatusData>;
}
