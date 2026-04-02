import process from 'node:process';

/**
 * 配置常量与枚举定义
 */

export interface Config {
  serverUrl: string;
  clientVersion: string;
  platform: 'qq' | 'wx';
  os: string;
  heartbeatInterval: number;
  farmCheckInterval: number;
  friendCheckInterval: number;
  farmCheckIntervalMin: number;
  farmCheckIntervalMax: number;
  friendCheckIntervalMin: number;
  friendCheckIntervalMax: number;
  adminPort: number;
  adminPassword: string;
  device_info: {
    client_version: string;
    sys_software: string;
    network: string;
    memory: string;
    device_id: string;
  };
}

export const CONFIG: Config = {
  serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
  clientVersion: '1.7.0.6_20260313',
  platform: 'qq',
  os: 'iOS',
  heartbeatInterval: 25000,
  farmCheckInterval: 2000,
  friendCheckInterval: 10000,
  farmCheckIntervalMin: 2000,
  farmCheckIntervalMax: 2000,
  friendCheckIntervalMin: 10000,
  friendCheckIntervalMax: 10000,
  adminPort: Number(process.env.ADMIN_PORT || 3000),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  device_info: {
    client_version: '1.7.0.6_20260313',
    sys_software: 'iOS 26.2.1',
    network: 'wifi',
    memory: '7672',
    device_id: 'iPhone X<iPhone18,3>',
  },
};

// 生长阶段枚举
export enum PlantPhase {
  UNKNOWN = 0,
  SEED = 1,
  GERMINATION = 2,
  SMALL_LEAVES = 3,
  LARGE_LEAVES = 4,
  BLOOMING = 5,
  MATURE = 6,
  DEAD = 7,
}

export const PHASE_NAMES: string[] = ['未知', '种子', '发芽', '小叶', '大叶', '开花', '成熟', '枯死'];
