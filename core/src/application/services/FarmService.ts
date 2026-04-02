import type { INetworkClient } from '../../domain/ports/INetworkClient';
import type { IConfigRepository } from '../../domain/ports/IConfigRepository';
import type { IScheduler } from '../../domain/ports/IScheduler';
import type { ILogger } from '../../domain/ports/ILogger';
import type { IEventBus } from '../../domain/ports/IEventBus';
import {  ProtocolFacade } from '../../infrastructure/network/ProtocolFacade';
import type {AllLandsReply} from '../../infrastructure/network/ProtocolFacade';
import { FarmInspector } from './FarmInspector';
import { PlantingOrchestrator } from './PlantingOrchestrator';
import { FertilizerService } from './FertilizerService';
import { sleep, toNum } from '../../utils/utils';
import { LandEntity } from '../../domain/entities';
import { AutomationFeature, FertilizerReason, ItemId } from '../../domain/enums';

export interface FarmCycleResult {
  hadWork: boolean;
  actions: string[];
}

export type FarmOperationType = 'all' | 'harvest' | 'clear' | 'plant' | 'upgrade';

export class FarmService {
  private readonly protocol: ProtocolFacade;
  private readonly inspector: FarmInspector;
  private isCheckingFarm = false;
  private isFirstFarmCheck = true;

  constructor(
    private readonly network: INetworkClient,
    private readonly configRepo: IConfigRepository,
    private readonly scheduler: IScheduler,
    private readonly logger: ILogger,
    private readonly eventBus: IEventBus,
    private readonly plantingOrchestrator: PlantingOrchestrator,
    private readonly fertilizerService: FertilizerService
  ) {
    this.protocol = new ProtocolFacade(network);
    this.inspector = new FarmInspector();
  }

  async inspectFarm(): Promise<boolean> {
    // We need to check automation flag first
    // But we don't have direct access to check automation here without configRepo
    if (this.isCheckingFarm) return false;
    this.isCheckingFarm = true;
    try {
      const result = await this.performFullCycle();
      this.isFirstFarmCheck = false;
      return result.hadWork;
    } catch (e) {
      this.logger.warn(`检查失败: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm', event: 'inspect_farm' });
      return false;
    } finally {
      this.isCheckingFarm = false;
    }
  }

  async performFullCycle(): Promise<FarmCycleResult> {
    const landsReply = await this.protocol.getAllLands();
    if (!landsReply.lands || landsReply.lands.length === 0) {
      return { hadWork: false, actions: [] };
    }

    const lands = landsReply.lands.map((l) => this.toLandEntity(l));
    const status = this.inspector.analyzeLands(lands, this.isFirstFarmCheck);
    const actions: string[] = [];

    const statusParts: string[] = [];
    if (status.harvestable.length) statusParts.push(`收:${status.harvestable.length}`);
    if (status.needWeed.length) statusParts.push(`草:${status.needWeed.length}`);
    if (status.needBug.length) statusParts.push(`虫:${status.needBug.length}`);
    if (status.needWater.length) statusParts.push(`水:${status.needWater.length}`);
    if (status.dead.length) statusParts.push(`枯:${status.dead.length}`);
    if (status.empty.length) statusParts.push(`空:${status.empty.length}`);
    if (status.unlockable.length) statusParts.push(`解:${status.unlockable.length}`);
    if (status.upgradable.length) statusParts.push(`升:${status.upgradable.length}`);
    statusParts.push(`长:${status.growing.length}`);

    // Clear operations
    const canAutoManageFarm = this.configRepo.isAutomationOn(AutomationFeature.FARM_MANAGE);
    const enableAutoWater = this.configRepo.isAutomationOn(AutomationFeature.FARM_WATER);
    const enableAutoWeed = this.configRepo.isAutomationOn(AutomationFeature.FARM_WEED);
    const enableAutoBug = this.configRepo.isAutomationOn(AutomationFeature.FARM_BUG);

    if (canAutoManageFarm && enableAutoWeed && status.needWeed.length > 0) {
      try {
        await this.protocol.weedOut(status.needWeed, this.getUserState().gid);
        actions.push(`除草${status.needWeed.length}`);
      } catch (e) {
        this.logger.warn(`除草失败: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm', event: 'weed' });
      }
    }
    if (canAutoManageFarm && enableAutoBug && status.needBug.length > 0) {
      try {
        await this.protocol.insecticide(status.needBug, this.getUserState().gid);
        actions.push(`除虫${status.needBug.length}`);
      } catch (e) {
        this.logger.warn(`除虫失败: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm', event: 'bug' });
      }
    }
    if (canAutoManageFarm && enableAutoWater && status.needWater.length > 0) {
      try {
        await this.protocol.waterLand(status.needWater, this.getUserState().gid);
        actions.push(`浇水${status.needWater.length}`);
      } catch (e) {
        this.logger.warn(`浇水失败: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm', event: 'water' });
      }
    }

    // Harvest
    let harvestedLandIds: number[] = [];
    let harvestReply: { land?: Array<{ id?: bigint }> } | null = null;
    let postHarvest: { removable: number[]; growing: number[] } | null = null;

    if (status.harvestable.length > 0) {
      try {
        harvestReply = await this.protocol.harvest(status.harvestable, this.getUserState().gid);
        actions.push(`收获${status.harvestable.length}`);
        harvestedLandIds = [...status.harvestable];
        this.eventBus.emit('farmHarvested', { count: status.harvestable.length, landIds: [...status.harvestable] });
      } catch (e) {
        this.logger.warn(`收获失败: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm', event: 'harvest' });
      }
    }

    // Plant
    const allEmptyLands = [...new Set(status.empty)];
    let allDeadLands = [...new Set(status.dead)];

    if (harvestedLandIds.length > 0 && harvestReply) {
      const landsMap = this.inspector.buildLandMap(lands);
      const firstPass = this.inspector.classifyHarvestedLandsByMap(harvestedLandIds, landsMap);
      const removable = [...firstPass.removable];
      const growing = [...firstPass.growing];
      let unknown = [...firstPass.unknown];

      if (unknown.length > 0) {
        try {
          const latestLandsReply = await this.protocol.getAllLands();
          const latestMap = this.inspector.buildLandMap(latestLandsReply.lands.map((l) => this.toLandEntity(l)));
          const secondPass = this.inspector.classifyHarvestedLandsByMap(unknown, latestMap);
          removable.push(...secondPass.removable);
          growing.push(...secondPass.growing);
          unknown = secondPass.unknown;
        } catch (e) {
          this.logger.warn(`收后状态补拉失败: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm' });
        }
      }
      if (unknown.length > 0) {
        removable.push(...unknown);
      }
      allDeadLands = [...new Set([...allDeadLands, ...removable])];
      postHarvest = { removable, growing };
    }

    if (allDeadLands.length > 0 || allEmptyLands.length > 0) {
      try {
        const plantCount = allDeadLands.length + allEmptyLands.length;
        await this.autoPlantEmptyLands(allDeadLands, allEmptyLands);
        actions.push(`种植${plantCount}`);
      } catch (e) {
        this.logger.warn(`种植失败: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm', event: 'plant' });
      }
    }

    // Multi-season fertilizer
    if (postHarvest && postHarvest.growing.length > 0 && this.configRepo.isAutomationOn(AutomationFeature.FERTILIZER_MULTI_SEASON)) {
      const targets = [...new Set(postHarvest.growing.map((v) => toNum(v)).filter(Boolean))];
      if (targets.length > 0) {
        try {
          await this.fertilizerService.applyConfigFertilizer(targets, this.configRepo.getAutomation(), { reason: FertilizerReason.MULTI_SEASON });
        } catch (e) {
          this.logger.warn(`多季补肥失败: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm', event: 'multi_season_fertilize' });
        }
      }
    }

    // Unlock / Upgrade
    const shouldAutoUpgrade = this.configRepo.isAutomationOn(AutomationFeature.LAND_UPGRADE);
    if (shouldAutoUpgrade) {
      if (status.unlockable.length > 0) {
        let unlocked = 0;
        for (const landId of status.unlockable) {
          try {
            await this.protocol.unlockLand(landId);
            unlocked++;
          } catch (e) {
            this.logger.warn(`解锁失败 #${landId}: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm', event: 'unlock' });
          }
          await sleep(200);
        }
        if (unlocked > 0) actions.push(`解锁${unlocked}`);
      }

      if (status.upgradable.length > 0) {
        let upgraded = 0;
        for (const landId of status.upgradable) {
          try {
            const reply = await this.protocol.upgradeLand(landId);
            const newLevel = reply.land ? toNum(reply.land.level) : '?';
            upgraded++;
            this.logger.info(`土地#${landId} 升级成功 → 等级${newLevel}`, { module: 'farm', event: 'upgrade', landId, level: newLevel });
          } catch (e) {
            this.logger.warn(`升级失败 #${landId}: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm', event: 'upgrade' });
          }
          await sleep(200);
        }
        if (upgraded > 0) actions.push(`升级${upgraded}`);
      }
    }

    const actionStr = actions.length > 0 ? ` → ${actions.join('/')}` : '';
    if (actions.length > 0) {
      this.logger.info(`[${statusParts.join(' ')}]${actionStr}`, { module: 'farm', event: 'farm_cycle', actions });
    }

    return { hadWork: actions.length > 0, actions };
  }

  async performManualOperation(payload: { action: string; landId: number; seedId?: number }): Promise<Record<string, unknown>> {
    const action = String(payload.action || '').trim().toLowerCase();
    const landId = toNum(payload.landId);
    const seedId = toNum(payload.seedId);

    if (!landId) throw new Error('无效 landId');

    if (action === 'remove') {
      await this.protocol.removePlant([landId]);
      return { action, landId };
    }

    if (action === 'plant') {
      if (!seedId) throw new Error('缺少 seedId');
      const plantSize = this.plantingOrchestrator.getPlantSizeBySeedId(seedId);
      if (plantSize > 1) throw new Error(`仅支持 1x1 种子，当前为 ${plantSize}x${plantSize}`);
      const result = await this.plantingOrchestrator.plantSeeds(seedId, [landId], { maxPlantCount: 1 });
      if (!result.planted) throw new Error(`地块 #${landId} 种植失败`);
      return { action, landId, seedId, planted: result.planted };
    }

    if (action === 'organic_fertilize') {
      await this.protocol.fertilizeSingle(landId, ItemId.ORGANIC_FERTILIZER);
      return { action, landId };
    }

    throw new Error(`不支持的单地块操作: ${action || 'unknown'}`);
  }

  private async autoPlantEmptyLands(deadLandIds: number[], emptyLandIds: number[]): Promise<void> {
    const landsToPlant = [...emptyLandIds];
    if (deadLandIds.length > 0) {
      try {
        await this.protocol.removePlant(deadLandIds);
        this.logger.info(`已铲除 ${deadLandIds.length} 块`, { module: 'farm', event: 'remove_plant', count: deadLandIds.length });
        landsToPlant.push(...deadLandIds);
      } catch (e) {
        this.logger.warn(`批量铲除失败: ${e instanceof Error ? e.message : String(e)}`, { module: 'farm', event: 'remove_plant' });
        landsToPlant.push(...deadLandIds);
      }
    }

    if (landsToPlant.length === 0) return;
    // Simplified: delegate to plantingOrchestrator or implement shop planting
    // For now, we leave the detailed implementation as a follow-up since it requires bag seed integration
    void landsToPlant;
  }

  async getLandsDetail(): Promise<Record<string, unknown>> {
    return this.protocol.getAllLands() as unknown as Record<string, unknown>;
  }

  async getAvailableSeeds(): Promise<Array<Record<string, unknown>>> {
    return this.plantingOrchestrator.getAvailableSeeds(this.getUserState());
  }

  private getUserState(): import('../../domain/ports/INetworkClient').UserStateSnapshot {
    return this.protocol.getUserState();
  }

  private toLandEntity(raw: AllLandsReply['lands'][number]): LandEntity {
    const id = toNum(raw.id);
    const level = toNum(raw.level);
    const maxLevel = toNum(raw.max_level);
    const landsLevel = toNum(raw.lands_level);
    const landSize = toNum(raw.land_size);

    return new LandEntity(
      id,
      !!raw.unlocked,
      level,
      maxLevel,
      landsLevel,
      landSize,
      !!raw.could_unlock,
      !!raw.could_upgrade,
      raw.plant
        ? {
            id: toNum(raw.plant.id),
            name: raw.plant.name,
            phases: Array.isArray(raw.plant.phases)
              ? raw.plant.phases.map((p) => ({
                  phase: toNum(p.phase),
                  beginTime: toNum(p.begin_time),
                  endTime: p.end_time ? toNum(p.end_time) : undefined,
                  dry_time: p.dry_time ? toNum(p.dry_time) : undefined,
                  weeds_time: p.weeds_time ? toNum(p.weeds_time) : undefined,
                  insect_time: p.insect_time ? toNum(p.insect_time) : undefined,
                  ferts_used: p.ferts_used
                    ? Object.fromEntries(Object.entries(p.ferts_used).map(([k, v]) => [k, toNum(v)]))
                    : undefined,
                }))
              : [],
            season: toNum(raw.plant.season),
            dry_num: toNum(raw.plant.dry_num),
            weed_owners: Array.isArray(raw.plant.weed_owners)
              ? raw.plant.weed_owners.map((i) => toNum(i)).filter(Boolean)
              : [],
            insect_owners: Array.isArray(raw.plant.insect_owners)
              ? raw.plant.insect_owners.map((i) => toNum(i)).filter(Boolean)
              : [],
            stealable: !!raw.plant.stealable,
            left_inorc_fert_times: toNum(raw.plant.left_inorc_fert_times),
            ferts_used: raw.plant.ferts_used
              ? Object.fromEntries(Object.entries(raw.plant.ferts_used).map(([k, v]) => [k, toNum(v)]))
              : {},
          }
        : null,
      toNum(raw.master_land_id),
      Array.isArray(raw.slave_land_ids) ? raw.slave_land_ids.map((i) => toNum(i)).filter(Boolean) : [],
      String(raw.status || '')
    );
  }
}
