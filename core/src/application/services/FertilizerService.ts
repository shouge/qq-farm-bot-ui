import { toNum, toTimeSec, getServerTimeSec, sleep } from '../../utils/utils';
import type { ILogger } from '../../domain/ports/ILogger';
import type { IScheduler } from '../../domain/ports/IScheduler';
import type { LandEntity, PlantData, PlantPhaseInfo } from '../../domain/entities';
import { ProtocolFacade } from '../../infrastructure/network/ProtocolFacade';
import type { INetworkClient } from '../../domain/ports/INetworkClient';
import type { AutomationConfig } from '../../domain/value-objects/AutomationConfig';

const NORMAL_FERTILIZER_ID = 1011;
const ORGANIC_FERTILIZER_ID = 1012;
const ALL_FERTILIZER_LAND_TYPES = ['gold', 'black', 'red', 'normal'] as const;

interface FertilizerPlan {
  landId: number;
  plantId: number;
  targetBeginTime: number;
  targetEndTime: number;
  targetPhase: number;
  reason: string;
  reasonLabel: string;
  eventName: string;
}

export class FertilizerService {
  private readonly protocol: ProtocolFacade;
  private readonly pendingPlans = new Map<number, FertilizerPlan>();

  constructor(
    network: INetworkClient,
    private readonly scheduler: IScheduler,
    private readonly logger: ILogger
  ) {
    this.protocol = new ProtocolFacade(network);
  }

  async applyConfigFertilizer(
    plantedLands: number[],
    automation: AutomationConfig,
    options: { reason?: string } = {}
  ): Promise<{ normal: number; organic: number }> {
    const fertilizerConfig = automation.fertilizer || 'none';
    const reason = String(options.reason || '').trim().toLowerCase() === 'multi_season' ? 'multi_season' : 'normal';
    const reasonLabel = reason === 'multi_season' ? '多季补肥' : '常规施肥';
    const eventName = reason === 'multi_season' ? '多季补肥' : 'fertilize';
    const selectedLandTypes = this.normalizeFertilizerLandTypes(automation.fertilizer_land_types);
    const selectedLandTypeNames = this.formatFertilizerLandTypes(selectedLandTypes);
    const planted = [...new Set((plantedLands || []).map((v) => toNum(v)).filter(Boolean))];

    if (selectedLandTypes.length === 0) {
      this.logger.info(`${reasonLabel}：未勾选施肥范围，跳过本轮施肥`, {
        module: 'farm',
        event: eventName,
        result: 'skip',
        reason,
      });
      return { normal: 0, organic: 0 };
    }

    if (planted.length === 0 && fertilizerConfig !== 'organic' && fertilizerConfig !== 'both') {
      return { normal: 0, organic: 0 };
    }

    let latestLands: LandEntity[] = [];
    const landTypeById = new Map<number, string>();
    try {
      const latest = await this.protocol.getAllLands();
      latestLands = (latest.lands || []).map((l) => this.toLandEntity(l));
      for (const land of latestLands) {
        if (!land) continue;
        landTypeById.set(land.id, this.getLandTypeByLevel(land.level));
      }
    } catch (e: any) {
      this.logger.warn(`${reasonLabel}：获取土地信息失败: ${e?.message || ''}`, {
        module: 'farm',
        event: eventName,
        result: 'error',
      });
    }

    const isAllSelected = selectedLandTypes.length === ALL_FERTILIZER_LAND_TYPES.length;
    if (landTypeById.size === 0 && !isAllSelected) {
      this.logger.warn(`${reasonLabel}：无法确认土地类型，已跳过`, { module: 'farm', event: eventName, result: 'skip' });
      return { normal: 0, organic: 0 };
    }

    let normalTargets = planted;
    if (landTypeById.size > 0) {
      normalTargets = this.filterLandIdsByTypes(planted, landTypeById, selectedLandTypes);
    }

    let fertilizedNormal = 0;
    let fertilizedOrganic = 0;

    if (fertilizerConfig === 'normal' || fertilizerConfig === 'both') {
      const normalLandMap = new Map(latestLands.map((land) => [land.id, land]));
      let scheduledNormal = 0;
      for (const landId of normalTargets) {
        const land = normalLandMap.get(landId);
        if (!land || !land.plant || !land.plant.phases || land.plant.phases.length === 0) continue;
        if (this.hasNormalFertilizerApplied(land.plant)) continue;
        if (this.scheduleNormalFertilizer(land, { reason })) {
          scheduledNormal += 1;
        }
      }
      fertilizedNormal = scheduledNormal;
      if (scheduledNormal > 0) {
        this.logger.info(`${reasonLabel}：已安排 ${scheduledNormal} 块地普通化肥`, {
          module: 'farm',
          event: eventName,
          result: 'scheduled',
          type: 'normal',
          count: scheduledNormal,
          landTypes: selectedLandTypes,
        });
      }
    }

    if (fertilizerConfig === 'organic' || fertilizerConfig === 'both') {
      let organicTargets = planted;
      if (latestLands.length > 0) {
        organicTargets = this.getOrganicFertilizerTargetsFromLands(latestLands);
      }
      if (landTypeById.size > 0) {
        organicTargets = this.filterLandIdsByTypes(organicTargets, landTypeById, selectedLandTypes);
      }

      fertilizedOrganic = await this.fertilizeOrganicLoop(organicTargets);
      if (fertilizedOrganic > 0) {
        this.logger.info(`${reasonLabel}：有机化肥循环施肥 ${fertilizedOrganic} 次`, {
          module: 'farm',
          event: eventName,
          result: 'ok',
          type: 'organic',
          count: fertilizedOrganic,
          landTypes: selectedLandTypes,
        });
      }
    }

    return { normal: fertilizedNormal, organic: fertilizedOrganic };
  }

  private toLandEntity(raw: any): LandEntity {
    return {
      id: toNum(raw.id),
      unlocked: !!raw.unlocked,
      level: toNum(raw.level),
      maxLevel: toNum(raw.max_level),
      landsLevel: toNum(raw.lands_level),
      landSize: toNum(raw.land_size),
      couldUnlock: !!raw.could_unlock,
      couldUpgrade: !!raw.could_upgrade,
      masterLandId: toNum(raw.master_land_id),
      slaveLandIds: Array.isArray(raw.slave_land_ids) ? raw.slave_land_ids.map((id: any) => toNum(id)).filter(Boolean) : [],
      status: String(raw.status || ''),
      plant: raw.plant
        ? {
            id: toNum(raw.plant.id),
            name: raw.plant.name,
            phases: Array.isArray(raw.plant.phases) ? raw.plant.phases : [],
            season: toNum(raw.plant.season),
            dry_num: toNum(raw.plant.dry_num),
            weed_owners: Array.isArray(raw.plant.weed_owners) ? raw.plant.weed_owners.map((id: any) => toNum(id)) : [],
            insect_owners: Array.isArray(raw.plant.insect_owners) ? raw.plant.insect_owners.map((id: any) => toNum(id)) : [],
            stealable: !!raw.plant.stealable,
            left_inorc_fert_times: toNum(raw.plant.left_inorc_fert_times),
            ferts_used: raw.plant.ferts_used || {},
          }
        : null,
      hasPlant: !!(raw.plant && Array.isArray(raw.plant.phases) && raw.plant.phases.length > 0),
      isOccupiedByMaster: false,
    } as LandEntity;
  }

  private getLandTypeByLevel(level: number): string {
    if (level >= 4) return 'gold';
    if (level === 3) return 'black';
    if (level === 2) return 'red';
    return 'normal';
  }

  private normalizeFertilizerLandTypes(input?: string[]): string[] {
    const source = Array.isArray(input) ? input : [];
    const result: string[] = [];
    for (const item of source) {
      const value = String(item || '').trim().toLowerCase();
      if (!ALL_FERTILIZER_LAND_TYPES.includes(value as typeof ALL_FERTILIZER_LAND_TYPES[number])) continue;
      if (result.includes(value)) continue;
      result.push(value);
    }
    return result;
  }

  private formatFertilizerLandTypes(types: string[]): string[] {
    const labels: Record<string, string> = {
      gold: '金土地',
      black: '黑土地',
      red: '红土地',
      normal: '普通土地',
    };
    return types.map((type) => labels[type] || type);
  }

  private filterLandIdsByTypes(landIds: number[], landTypeById: Map<number, string>, selectedTypes: string[]): number[] {
    const selected = new Set(selectedTypes);
    if (selected.size === 0) return [];
    if (selected.size === ALL_FERTILIZER_LAND_TYPES.length) return [...landIds];
    return landIds.filter((id) => {
      const type = landTypeById.get(id);
      return type && selected.has(type);
    });
  }

  private getOrganicFertilizerTargetsFromLands(lands: LandEntity[]): number[] {
    const targets: number[] = [];
    for (const land of lands) {
      if (!land.unlocked) continue;
      if (!land.plant || !land.plant.phases || land.plant.phases.length === 0) continue;
      const currentPhase = this.getCurrentPhase(land.plant.phases);
      if (!currentPhase) continue;
      if (currentPhase.phase === 0 /* DEAD */) continue; // PlantPhase.DEAD = 0 typically, mapping based on config

      if (Object.prototype.hasOwnProperty.call(land.plant, 'left_inorc_fert_times')) {
        const leftTimes = toNum(land.plant.left_inorc_fert_times);
        if (leftTimes <= 0) continue;
      }

      targets.push(land.id);
    }
    return targets;
  }

  private getCurrentPhase(phases: PlantPhaseInfo[]): PlantPhaseInfo | null {
    if (!phases || phases.length === 0) return null;
    const nowSec = getServerTimeSec();
    for (let i = phases.length - 1; i >= 0; i--) {
      const beginTime = toTimeSec(phases[i].beginTime);
      if (beginTime > 0 && beginTime <= nowSec) return phases[i];
    }
    return phases[0];
  }

  private hasNormalFertilizerApplied(plant: PlantData): boolean {
    const phases = plant.phases || [];
    for (const phaseInfo of phases) {
      const fertsUsed = phaseInfo.ferts_used;
      if (!fertsUsed || typeof fertsUsed !== 'object') continue;
      for (const [key, val] of Object.entries(fertsUsed)) {
        if (toNum(key) === NORMAL_FERTILIZER_ID && toNum(val) > 0) return true;
      }
    }
    return false;
  }

  private getPlantPhaseWindows(plant: PlantData): Array<{ phase: number; beginTime: number; endTime: number; duration: number }> {
    const phases = plant.phases || [];
    const windows: Array<{ phase: number; beginTime: number; endTime: number; duration: number }> = [];
    for (let i = 0; i < phases.length; i++) {
      const current = phases[i];
      if (!current) continue;
      const phase = toNum(current.phase);
      if (phase === 0 || phase === 5 || phase === 6) continue; // UNKNOWN, MATURE, DEAD - approximate
      const beginTime = toTimeSec(current.beginTime);
      if (beginTime <= 0) continue;

      let endTime = 0;
      for (let j = i + 1; j < phases.length; j++) {
        const nextBegin = toTimeSec(phases[j]?.beginTime);
        if (nextBegin > beginTime) {
          endTime = nextBegin;
          break;
        }
      }
      const duration = endTime > beginTime ? endTime - beginTime : 0;
      if (duration <= 0) continue;
      windows.push({ phase, beginTime, endTime, duration });
    }
    return windows;
  }

  private getLongestNormalFertilizerWindow(plant: PlantData): { phase: number; beginTime: number; endTime: number; duration: number } | null {
    const windows = this.getPlantPhaseWindows(plant);
    if (windows.length === 0) return null;
    let best = windows[0];
    for (const w of windows) {
      if (w.duration > best.duration || (w.duration === best.duration && w.beginTime < best.beginTime)) {
        best = w;
      }
    }
    return best;
  }

  scheduleNormalFertilizer(land: LandEntity, options: { reason?: string } = {}): boolean {
    const landId = land.id;
    if (!landId || !land.plant) return false;

    const targetWindow = this.getLongestNormalFertilizerWindow(land.plant);
    if (!targetWindow) return false;
    this.clearPendingPlan(landId);

    const reason = String(options.reason || '').trim().toLowerCase() === 'multi_season' ? 'multi_season' : 'normal';
    const reasonLabel = reason === 'multi_season' ? '多季补肥' : '常规施肥';
    const eventName = reason === 'multi_season' ? '多季补肥' : 'fertilize';
    const plan: FertilizerPlan = {
      landId,
      plantId: toNum(land.plant.id),
      targetBeginTime: targetWindow.beginTime,
      targetEndTime: targetWindow.endTime,
      targetPhase: targetWindow.phase,
      reason,
      reasonLabel,
      eventName,
    };

    this.pendingPlans.set(landId, plan);
    const delayMs = Math.max(0, (targetWindow.beginTime - getServerTimeSec()) * 1000);
    this.scheduler.setTimeout(`normal_fertilize_${landId}`, delayMs, async () => {
      await this.applyScheduledNormalFertilizer(landId, plan);
    });
    return true;
  }

  clearPendingPlan(landId: number): boolean {
    const id = toNum(landId);
    if (!id) return false;
    this.pendingPlans.delete(id);
    return this.scheduler.clear(`normal_fertilize_${id}`);
  }

  async applyScheduledNormalFertilizer(landId: number, plan?: FertilizerPlan): Promise<number> {
    const id = toNum(landId);
    if (!id) return 0;

    const activePlan = plan || this.pendingPlans.get(id);
    if (!activePlan) return 0;

    try {
      const latest = await this.protocol.getAllLands();
      const lands = (latest.lands || []).map((l) => this.toLandEntity(l));
      const land = lands.find((item) => item.id === id);
      if (!land || !land.unlocked || !land.plant || !land.plant.phases || land.plant.phases.length === 0) {
        this.pendingPlans.delete(id);
        return 0;
      }

      const plantId = toNum(land.plant.id);
      if (activePlan.plantId > 0 && plantId > 0 && activePlan.plantId !== plantId) {
        this.pendingPlans.delete(id);
        return 0;
      }
      if (this.hasNormalFertilizerApplied(land.plant)) {
        this.pendingPlans.delete(id);
        return 0;
      }

      const currentPhase = this.getCurrentPhase(land.plant.phases);
      const currentPhaseVal = toNum(currentPhase?.phase);
      if (currentPhaseVal === 5 || currentPhaseVal === 6 || currentPhaseVal === 0) {
        // MATURE, DEAD, UNKNOWN
        this.pendingPlans.delete(id);
        return 0;
      }

      const targetWindow = this.getLongestNormalFertilizerWindow(land.plant);
      if (!targetWindow) {
        this.pendingPlans.delete(id);
        return 0;
      }

      const nowSec = getServerTimeSec();
      if (nowSec < targetWindow.beginTime) {
        this.scheduleNormalFertilizer(land, { reason: activePlan.reason });
        return 0;
      }
      if (nowSec >= targetWindow.endTime) {
        this.pendingPlans.delete(id);
        return 0;
      }

      await this.protocol.fertilizeSingle(id, NORMAL_FERTILIZER_ID);
      this.pendingPlans.delete(id);
      this.logger.info(`${activePlan.reasonLabel}：土地#${id} 普通化肥已施用`, {
        module: 'farm',
        event: activePlan.eventName,
        result: 'ok',
        type: 'normal',
        landId: id,
        phase: targetWindow.phase,
      });
      return 1;
    } catch (e: any) {
      this.logger.warn(`普通化肥延迟施肥失败: ${e?.message || ''}`, {
        module: 'farm',
        event: plan?.eventName || 'fertilize',
        result: 'error',
        landId: id,
      });
      return 0;
    }
  }

  async fertilizeOrganicLoop(landIds: number[]): Promise<number> {
    const ids = (Array.isArray(landIds) ? landIds : []).filter(Boolean);
    if (ids.length === 0) return 0;

    let successCount = 0;
    let idx = 0;
    while (true) {
      const landId = ids[idx];
      try {
        await this.protocol.fertilizeSingle(landId, ORGANIC_FERTILIZER_ID);
        successCount++;
      } catch {
        break;
      }
      idx = (idx + 1) % ids.length;
      await sleep(1000);
    }
    return successCount;
  }
}
