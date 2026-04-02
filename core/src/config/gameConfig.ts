/**
 * 游戏配置数据模块
 * 从 gameConfig 目录加载配置数据
 */

import fs from 'node:fs';
import path from 'node:path';
import { getResourcePath } from './runtime-paths';

/** 角色等级配置项 */
export interface RoleLevelConfigItem {
  level: number;
  exp: number;
}

/** 植物生长阶段 */
export interface PlantGrowPhase {
  phase: number;
  begin_time: bigint;
  end_time?: bigint;
  dry_time?: bigint;
  weeds_time?: bigint;
  insect_time?: bigint;
}

/** 植物果实信息 */
export interface PlantFruit {
  id: number;
  name?: string;
}

/** 植物配置 */
export interface PlantConfig {
  id: number;
  name: string;
  seed_id: number;
  land_level_need: number;
  seasons: number;
  exp: number;
  grow_phases: string;
  fruit?: PlantFruit;
  size?: number;
}

/** 物品信息配置 */
export interface ItemInfoConfig {
  id: number;
  name: string;
  type: number;
  price: number;
  asset_name?: string;
}

/** 种子信息 */
export interface SeedInfo {
  plantId: number;
  seedId: number;
  name: string;
  requiredLevel: number;
  price: number;
  image: string;
}

/** 等级经验进度 */
export interface LevelExpProgress {
  current: number;
  needed: number;
}

/** 配置重载回调函数类型 */
export type ConfigReloadCallback = () => void;

// Module-level regex constants to avoid re-compilation
const SEED_IMAGE_BY_ID_REGEX = /^(\d+)_.*\.(?:png|jpg|jpeg|webp|gif)$/i;
const SEED_IMAGE_BY_ASSET_REGEX = /(Crop_\d+)_Seed\.(?:png|jpg|jpeg|webp|gif)$/i;
const GROW_PHASE_REGEX = /:(\d+)/;

// ============ 等级经验表 ============
let roleLevelConfig: RoleLevelConfigItem[] | null = null;
let levelExpTable: number[] | null = null; // 累计经验表，索引为等级

// ============ 植物配置 ============
let plantConfig: PlantConfig[] | null = null;
const plantMap = new Map<number, PlantConfig>(); // id -> plant
const seedToPlant = new Map<number, PlantConfig>(); // seed_id -> plant
const fruitToPlant = new Map<number, PlantConfig>(); // fruit_id -> plant (果实ID -> 植物)
let itemInfoConfig: ItemInfoConfig[] | null = null;
const itemInfoMap = new Map<number, ItemInfoConfig>(); // item_id -> item
const seedItemMap = new Map<number, ItemInfoConfig>(); // seed_id -> item(type=5)
const seedImageMap = new Map<number, string>(); // seed_id -> image url
const seedAssetImageMap = new Map<string, string>(); // asset_name (Crop_xxx) -> image url

// ============ 热重载相关 ============
let configWatcher: fs.FSWatcher | null = null;
const watcherCallbacks = new Set<ConfigReloadCallback>();
const CONFIG_FILES = ['RoleLevel.json', 'Plant.json', 'ItemInfo.json'];

/**
 * 监听配置变更回调
 * @param callback - 配置重载后的回调函数
 * @returns 取消监听的函数
 */
export function onConfigReload(callback: ConfigReloadCallback): () => void {
  watcherCallbacks.add(callback);
  return () => watcherCallbacks.delete(callback);
}

/**
 * 触发配置重载回调
 */
export function emitConfigReload(): void {
  for (const cb of watcherCallbacks) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 启动配置文件热重载监听（开发环境使用）
 * @param enabled - 是否启用
 */
export function enableHotReload(enabled = true): void {
  if (!enabled) {
    if (configWatcher) {
      configWatcher.close();
      configWatcher = null;
      console.warn('[配置] 已停止热重载监听');
    }
    return;
  }

  if (configWatcher) return; // 已启用

  const configDir = getResourcePath('gameConfig');
  if (!fs.existsSync(configDir)) {
    console.warn('[配置] 配置目录不存在，无法启用热重载');
    return;
  }

  try {
    configWatcher = fs.watch(configDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // 只监听关心的配置文件
      const isTargetFile =
        CONFIG_FILES.some((name) => filename.includes(name)) || filename.includes('seed_images_named');
      if (!isTargetFile) return;

      // 防抖：500ms内多次变更只重载一次
      if ((configWatcher as fs.FSWatcher & { _reloadTimer?: NodeJS.Timeout })._reloadTimer) {
        clearTimeout((configWatcher as fs.FSWatcher & { _reloadTimer?: NodeJS.Timeout })._reloadTimer);
      }
      (configWatcher as fs.FSWatcher & { _reloadTimer?: NodeJS.Timeout })._reloadTimer = setTimeout(
        () => {
          (configWatcher as fs.FSWatcher & { _reloadTimer?: NodeJS.Timeout })._reloadTimer = undefined;
          console.warn(`[配置] 检测到 ${filename} 变更，正在热重载...`);
          const oldPlantCount = plantMap.size;
          const oldItemCount = itemInfoMap.size;

          loadConfigs();

          console.warn(
            `[配置] 热重载完成: 植物 ${oldPlantCount}->${plantMap.size}, 物品 ${oldItemCount}->${itemInfoMap.size}`
          );
          emitConfigReload();
        },
        500
      );
    });
    console.warn('[配置] 已启用热重载监听');
  } catch (e) {
    console.warn('[配置] 启用热重载失败:', (e as Error).message);
  }
}

/**
 * 手动触发配置重载
 * @returns 重载后的配置统计
 */
export function reloadConfigs(): { plants: number; items: number; roleLevels: number; seedImages: number } {
  console.warn('[配置] 手动触发配置重载...');
  loadConfigs();
  emitConfigReload();
  console.warn('[配置] 重载完成');
  return {
    plants: plantMap.size,
    items: itemInfoMap.size,
    roleLevels: roleLevelConfig?.length || 0,
    seedImages: seedImageMap.size,
  };
}

/**
 * 加载配置文件
 */
export function loadConfigs(): void {
  const configDir = getResourcePath('gameConfig');

  // 加载等级经验配置
  try {
    const roleLevelPath = path.join(configDir, 'RoleLevel.json');
    if (fs.existsSync(roleLevelPath)) {
      roleLevelConfig = JSON.parse(fs.readFileSync(roleLevelPath, 'utf8')) as RoleLevelConfigItem[];
      // 构建累计经验表
      levelExpTable = [];
      for (const item of roleLevelConfig) {
        levelExpTable[item.level] = item.exp;
      }
      console.warn(`[配置] 已加载等级经验表 (${roleLevelConfig.length} 级)`);
    }
  } catch (e) {
    console.warn('[配置] 加载 RoleLevel.json 失败:', (e as Error).message);
  }

  // 加载植物配置
  try {
    const plantPath = path.join(configDir, 'Plant.json');
    if (fs.existsSync(plantPath)) {
      plantConfig = JSON.parse(fs.readFileSync(plantPath, 'utf8')) as PlantConfig[];
      plantMap.clear();
      seedToPlant.clear();
      fruitToPlant.clear();
      for (const plant of plantConfig) {
        plantMap.set(plant.id, plant);
        if (plant.seed_id) {
          seedToPlant.set(plant.seed_id, plant);
        }
        if (plant.fruit && plant.fruit.id) {
          fruitToPlant.set(plant.fruit.id, plant);
        }
      }
      console.warn(`[配置] 已加载植物配置 (${plantConfig.length} 种)`);
    }
  } catch (e) {
    console.warn('[配置] 加载 Plant.json 失败:', (e as Error).message);
  }

  // 加载物品配置（含种子/果实价格）
  try {
    const itemInfoPath = path.join(configDir, 'ItemInfo.json');
    if (fs.existsSync(itemInfoPath)) {
      itemInfoConfig = JSON.parse(fs.readFileSync(itemInfoPath, 'utf8')) as ItemInfoConfig[];
      itemInfoMap.clear();
      seedItemMap.clear();
      for (const item of itemInfoConfig) {
        const id = Number(item && item.id) || 0;
        if (id <= 0) continue;
        itemInfoMap.set(id, item);
        if (Number(item.type) === 5) {
          seedItemMap.set(id, item);
        }
      }
      console.warn(`[配置] 已加载物品配置 (${itemInfoConfig.length} 项)`);
    }
  } catch (e) {
    console.warn('[配置] 加载 ItemInfo.json 失败:', (e as Error).message);
  }

  // 加载种子图片映射（seed_images_named）
  try {
    const seedImageDir = path.join(configDir, 'seed_images_named');
    seedImageMap.clear();
    seedAssetImageMap.clear();
    if (fs.existsSync(seedImageDir)) {
      const files = fs.readdirSync(seedImageDir);
      for (const file of files) {
        const filename = String(file || '');
        const fileUrl = `/game-config/seed_images_named/${encodeURIComponent(file)}`;

        // 1) id_..._Seed.png 命名，按 id 建立映射
        const byId = filename.match(SEED_IMAGE_BY_ID_REGEX);
        if (byId) {
          const seedId = Number(byId[1]) || 0;
          if (seedId > 0 && !seedImageMap.has(seedId)) {
            seedImageMap.set(seedId, fileUrl);
          }
        }

        // 2) ...Crop_xxx_Seed.png 命名，按 asset_name 建立映射
        const byAsset = filename.match(SEED_IMAGE_BY_ASSET_REGEX);
        if (byAsset) {
          const assetName = byAsset[1];
          if (assetName && !seedAssetImageMap.has(assetName)) {
            seedAssetImageMap.set(assetName, fileUrl);
          }
        }
      }
      console.warn(`[配置] 已加载种子图片映射 (${seedImageMap.size} 项)`);
    }
  } catch (e) {
    console.warn('[配置] 加载 seed_images_named 失败:', (e as Error).message);
  }
}

// ============ 等级经验相关 ============

/**
 * 获取等级经验表
 * @returns 等级经验表数组
 */
export function getLevelExpTable(): number[] | null {
  return levelExpTable;
}

/**
 * 计算当前等级的经验进度
 * @param level - 当前等级
 * @param totalExp - 累计总经验
 * @returns 当前等级经验进度
 */
export function getLevelExpProgress(level: number, totalExp: number): LevelExpProgress {
  if (!levelExpTable || level <= 0) return { current: 0, needed: 0 };

  const currentLevelStart = levelExpTable[level] || 0;
  const nextLevelStart = levelExpTable[level + 1] || currentLevelStart + 100000;

  const currentExp = Math.max(0, totalExp - currentLevelStart);
  const neededExp = nextLevelStart - currentLevelStart;

  return { current: currentExp, needed: neededExp };
}

// ============ 植物配置相关 ============

/**
 * 根据植物ID获取植物信息
 * @param plantId - 植物ID
 * @returns 植物配置或undefined
 */
export function getPlantById(plantId: number): PlantConfig | undefined {
  return plantMap.get(plantId);
}

/**
 * 根据种子ID获取植物信息
 * @param seedId - 种子ID
 * @returns 植物配置或undefined
 */
export function getPlantBySeedId(seedId: number): PlantConfig | undefined {
  return seedToPlant.get(seedId);
}

/**
 * 获取植物名称
 * @param plantId - 植物ID
 * @returns 植物名称
 */
export function getPlantName(plantId: number): string {
  const plant = plantMap.get(plantId);
  return plant ? plant.name : `植物${plantId}`;
}

/**
 * 根据种子ID获取植物名称
 * @param seedId - 种子ID
 * @returns 植物名称
 */
export function getPlantNameBySeedId(seedId: number): string {
  const plant = seedToPlant.get(seedId);
  return plant ? plant.name : `种子${seedId}`;
}

/**
 * 获取植物的生长时间（秒）
 * @param plantId - 植物ID
 * @returns 生长时间（秒）
 */
export function getPlantGrowTime(plantId: number): number {
  const plant = plantMap.get(plantId);
  if (!plant || !plant.grow_phases) return 0;

  // 解析 "种子:30;发芽:30;成熟:0;" 格式
  const phases = plant.grow_phases.split(';').filter((p) => p);
  const durations: number[] = [];
  for (const phase of phases) {
    const match = phase.match(GROW_PHASE_REGEX);
    if (match) {
      durations.push(Number.parseInt(match[1], 10) || 0);
    }
  }

  const totalSeconds = durations.reduce((sum, duration) => sum + duration, 0);
  if (Number(plant.seasons) !== 2) {
    return totalSeconds;
  }

  const lastTwoDurations = durations.filter((duration) => duration > 0).slice(-2);
  return totalSeconds + lastTwoDurations.reduce((sum, duration) => sum + duration, 0);
}

/**
 * 格式化时间
 * @param seconds - 秒数
 * @returns 格式化后的时间字符串
 */
export function formatGrowTime(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
}

/**
 * 获取植物的收获经验
 * @param plantId - 植物ID
 * @returns 经验值
 */
export function getPlantExp(plantId: number): number {
  const plant = plantMap.get(plantId);
  return plant ? plant.exp : 0;
}

/**
 * 根据果实ID获取植物名称
 * @param fruitId - 果实ID
 * @returns 植物名称
 */
export function getFruitName(fruitId: number): string {
  const plant = fruitToPlant.get(fruitId);
  return plant ? plant.name : `果实${fruitId}`;
}

/**
 * 根据果实ID获取植物信息
 * @param fruitId - 果实ID
 * @returns 植物配置或undefined
 */
export function getPlantByFruitId(fruitId: number): PlantConfig | undefined {
  return fruitToPlant.get(fruitId);
}

/**
 * 获取所有种子信息（用于备选）
 * @returns 种子信息数组
 */
export function getAllSeeds(): SeedInfo[] {
  return Array.from(seedToPlant.values()).map((p) => ({
    plantId: Number(p.id) || 0,
    seedId: p.seed_id,
    name: p.name,
    requiredLevel: Number(p.land_level_need) || 0,
    price: getSeedPrice(p.seed_id),
    image: getSeedImageBySeedId(p.seed_id),
  }));
}

/**
 * 获取映射后的种子图片
 * @param targetId - 目标ID
 * @returns 图片URL
 */
export function getMappedSeedImage(targetId: number): string {
  const id = Number(targetId) || 0;
  if (id <= 0) return '';

  const direct = seedImageMap.get(id);
  if (direct) return direct;

  const item = itemInfoMap.get(id);
  const assetName = item && item.asset_name ? String(item.asset_name).trim() : '';
  if (!assetName) return '';

  return seedAssetImageMap.get(assetName) || '';
}

/**
 * 根据种子ID获取种子图片
 * @param seedId - 种子ID
 * @returns 图片URL
 */
export function getSeedImageBySeedId(seedId: number): string {
  return getMappedSeedImage(seedId);
}

/**
 * 根据物品ID获取物品图片
 * @param itemId - 物品ID
 * @returns 图片URL
 */
export function getItemImageById(itemId: number): string {
  const id = Number(itemId) || 0;
  if (id <= 0) return '';

  // 内部函数：根据 ID 获取图片
  const getImg = (targetId: number): string => {
    // 1. 优先按物品ID命中（如 20003_胡萝卜_Crop_3_Seed.png）
    const direct = seedImageMap.get(targetId);
    if (direct) return direct;

    // 2. 其次按 ItemInfo.asset_name 命中（如 Crop_3_Seed.png）
    const item = itemInfoMap.get(targetId);
    const assetName = item && item.asset_name ? String(item.asset_name) : '';
    if (assetName) {
      const byAsset = seedAssetImageMap.get(assetName);
      if (byAsset) return byAsset;
    }
    return '';
  };

  // 1. 尝试直接获取
  let img = getImg(id);
  if (img) return img;

  // 2. 如果是果实，尝试获取对应的种子图片
  const plant = getPlantByFruitId(id);
  if (plant && plant.seed_id) {
    img = getImg(plant.seed_id);
    if (img) return img;
  }

  return '';
}

/**
 * 根据物品ID获取物品信息
 * @param itemId - 物品ID
 * @returns 物品配置或undefined
 */
export function getItemById(itemId: number): ItemInfoConfig | undefined {
  return itemInfoMap.get(Number(itemId) || 0);
}

/**
 * 获取种子价格
 * @param seedId - 种子ID
 * @returns 价格
 */
export function getSeedPrice(seedId: number): number {
  const item = seedItemMap.get(Number(seedId) || 0);
  return item ? Number(item.price) || 0 : 0;
}

/**
 * 获取果实价格
 * @param fruitId - 果实ID
 * @returns 价格
 */
export function getFruitPrice(fruitId: number): number {
  const item = itemInfoMap.get(Number(fruitId) || 0);
  return item ? Number(item.price) || 0 : 0;
}

/**
 * 获取所有植物配置
 * @returns 植物配置数组
 */
export function getAllPlants(): PlantConfig[] {
  return Array.from(plantMap.values());
}

// 启动时加载配置
loadConfigs();
