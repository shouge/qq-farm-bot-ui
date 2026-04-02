import { getAllSeeds, getPlantBySeedId, getPlantNameBySeedId, getSeedImageBySeedId } from '../../config/gameConfig';
import { sleep, toNum } from '../../utils/utils';
import type { INetworkClient } from '../../domain/ports/INetworkClient';
import type { ILogger } from '../../domain/ports/ILogger';
import type { ISeedSelectionStrategy, SeedInfo } from '../strategies/ISeedSelectionStrategy';
import { ProtocolFacade } from '../../infrastructure/network/ProtocolFacade';
import * as protobuf from 'protobufjs';

export interface PlantResult {
  planted: number;
  plantedLandIds: number[];
  occupiedLandIds: number[];
}

export class PlantingOrchestrator {
  private readonly protocol: ProtocolFacade;

  constructor(
    network: INetworkClient,
    private readonly strategy: ISeedSelectionStrategy,
    private readonly logger: ILogger,
    private readonly getBagSeedsFn?: () => Promise<Array<{ seedId: number; name: string; count: number; plantSize: number; requiredLevel: number }>>,
    private readonly setStrategyFallbackFn?: (strategy: string) => void
  ) {
    this.protocol = new ProtocolFacade(network);
  }

  async findBestSeed(state: ReturnType<INetworkClient['getUserState']>): Promise<SeedInfo | null> {
    const SEED_SHOP_ID = 2;
    const shopReply = await this.protocol.getShopInfo(SEED_SHOP_ID);
    if (!shopReply.goods_list || shopReply.goods_list.length === 0) {
      this.logger.warn('种子商店无商品', { module: 'farm', event: 'seed_shop' });
      return null;
    }

    const available: SeedInfo[] = [];
    for (const goods of shopReply.goods_list) {
      if (!goods.unlocked) continue;

      let meetsConditions = true;
      let requiredLevel = 0;
      for (const cond of goods.conds || []) {
        if (toNum(cond.type) === 1) {
          requiredLevel = toNum(cond.param);
          if (state.level < requiredLevel) {
            meetsConditions = false;
            break;
          }
        }
      }
      if (!meetsConditions) continue;

      const limitCount = toNum(goods.limit_count);
      const boughtNum = toNum(goods.bought_num);
      if (limitCount > 0 && boughtNum >= limitCount) continue;

      available.push({
        goodsId: toNum(goods.id),
        seedId: toNum(goods.item_id),
        price: toNum(goods.price),
        requiredLevel,
      });
    }

    if (available.length === 0) {
      this.logger.warn('没有可购买的种子', { module: 'farm', event: 'seed_shop' });
      return null;
    }

    return this.strategy.selectSeed(available, state);
  }

  async getAvailableSeeds(state: ReturnType<INetworkClient['getUserState']>): Promise<
    Array<{
      seedId: number;
      plantId: number;
      goodsId: number;
      name: string;
      price: number | null;
      requiredLevel: number | null;
      image: string;
      locked: boolean;
      soldOut: boolean;
      unknownMeta?: boolean;
    }>
  > {
    const SEED_SHOP_ID = 2;
    const list: Array<{
      seedId: number;
      plantId: number;
      goodsId: number;
      name: string;
      price: number | null;
      requiredLevel: number | null;
      image: string;
      locked: boolean;
      soldOut: boolean;
      unknownMeta?: boolean;
    }> = [];

    try {
      const shopReply = await this.protocol.getShopInfo(SEED_SHOP_ID);
      if (shopReply.goods_list) {
        for (const goods of shopReply.goods_list) {
          let requiredLevel = 0;
          for (const cond of goods.conds || []) {
            if (toNum(cond.type) === 1) requiredLevel = toNum(cond.param);
          }

          const limitCount = toNum(goods.limit_count);
          const boughtNum = toNum(goods.bought_num);
          const isSoldOut = limitCount > 0 && boughtNum >= limitCount;

          const seedId = toNum(goods.item_id);
          const plantCfg = getPlantBySeedId(seedId);
          const plantId = toNum(plantCfg?.id);

          list.push({
            seedId,
            plantId,
            goodsId: toNum(goods.id),
            name: getPlantNameBySeedId(seedId),
            price: toNum(goods.price),
            requiredLevel,
            image: getSeedImageBySeedId(seedId) || '',
            locked: !goods.unlocked || state.level < requiredLevel,
            soldOut: isSoldOut,
          });
        }
      }
    } catch {
      // ignore
    }

    if (list.length === 0) {
      const allSeeds = getAllSeeds();
      return allSeeds.map((s) => ({
        ...s,
        goodsId: 0,
        price: null,
        requiredLevel: null,
        unknownMeta: true,
        locked: false,
        soldOut: false,
      }));
    }

    return list.sort((a, b) => {
      const av = a.requiredLevel ?? 9999;
      const bv = b.requiredLevel ?? 9999;
      return av - bv;
    });
  }

  async plantSeeds(seedId: number, landIds: number[], options: { maxPlantCount?: number } = {}): Promise<PlantResult> {
    let successCount = 0;
    const plantedLandIds: number[] = [];
    const occupiedLandIds = new Set<number>();
    const maxPlantCount = options.maxPlantCount ?? Number.POSITIVE_INFINITY;
    const pendingLandIds = new Set((landIds).map((id) => toNum(id)).filter(Boolean));

    for (const rawLandId of landIds) {
      const landId = toNum(rawLandId);
      if (!landId || !pendingLandIds.has(landId)) continue;
      if (successCount >= maxPlantCount) break;

      try {
        await this.protocol.plantRaw(seedId, [landId]);
        successCount++;
        plantedLandIds.push(landId);
        occupiedLandIds.add(landId);
        pendingLandIds.delete(landId);
      } catch (e: any) {
        this.logger.warn(`土地#${landId} 种植失败: ${e?.message || ''}`, { module: 'farm', event: 'plant_seed' });
      }
      if (landIds.length > 1) await sleep(50);
    }

    return {
      planted: successCount,
      plantedLandIds,
      occupiedLandIds: [...occupiedLandIds],
    };
  }

  private encodePlantRequest(seedId: number, landIds: number[]): Uint8Array {
    const writer = protobuf.Writer.create();
    const itemWriter = writer.uint32(18).fork();
    itemWriter.uint32(8).int64(seedId);
    const idsWriter = itemWriter.uint32(18).fork();
    for (const id of landIds) {
      idsWriter.int64(id);
    }
    idsWriter.ldelim();
    itemWriter.ldelim();
    return writer.finish();
  }

  getPlantSizeBySeedId(seedId: number): number {
    const plantCfg = getPlantBySeedId(toNum(seedId));
    return Math.max(1, toNum(plantCfg?.size) || 1);
  }
}
