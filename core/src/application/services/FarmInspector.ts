import { PHASE_NAMES, PlantPhase } from '../../config/config';
import { getPlantExp, getPlantName } from '../../config/gameConfig';
import { getServerTimeSec, toTimeSec } from '../../utils/utils';
import type { LandEntity, PlantPhaseInfo } from '../../domain/entities';

export interface LandAnalysisResult {
  harvestable: number[];
  needWater: number[];
  needWeed: number[];
  needBug: number[];
  growing: number[];
  empty: number[];
  dead: number[];
  unlockable: number[];
  upgradable: number[];
  harvestableInfo: Array<{ landId: number; plantId: number; name: string; exp: number }>;
}

export class FarmInspector {
  analyzeLands(lands: LandEntity[], debug = false): LandAnalysisResult {
    const result: LandAnalysisResult = {
      harvestable: [],
      needWater: [],
      needWeed: [],
      needBug: [],
      growing: [],
      empty: [],
      dead: [],
      unlockable: [],
      upgradable: [],
      harvestableInfo: [],
    };

    const nowSec = getServerTimeSec();

    for (const land of lands) {
      const id = land.id;
      if (!land.unlocked) {
        if (land.couldUnlock) result.unlockable.push(id);
        continue;
      }
      if (land.couldUpgrade) result.upgradable.push(id);

      if (land.isOccupiedByMaster) continue;

      const plant = land.plant;
      if (!plant || !plant.phases || plant.phases.length === 0) {
        result.empty.push(id);
        continue;
      }

      const plantName = plant.name || '未知作物';
      const landLabel = `土地#${id}(${plantName})`;
      const currentPhase = this.getCurrentPhase(plant.phases, debug, landLabel);
      if (!currentPhase) {
        result.empty.push(id);
        continue;
      }
      const phaseVal = currentPhase.phase;

      if (phaseVal === PlantPhase.DEAD) {
        result.dead.push(id);
        continue;
      }

      if (phaseVal === PlantPhase.MATURE) {
        result.harvestable.push(id);
        const plantId = plant.id || 0;
        const plantNameFromConfig = getPlantName(plantId);
        const plantExp = getPlantExp(plantId);
        result.harvestableInfo.push({ landId: id, plantId, name: plantNameFromConfig || plantName, exp: plantExp });
        continue;
      }

      const dryNum = plant.dry_num || 0;
      const dryTime = toTimeSec(currentPhase.dry_time);
      if (dryNum > 0 || (dryTime > 0 && dryTime <= nowSec)) {
        result.needWater.push(id);
      }

      const weedsTime = toTimeSec(currentPhase.weeds_time);
      const hasWeeds = (plant.weed_owners && plant.weed_owners.length > 0) || (weedsTime > 0 && weedsTime <= nowSec);
      if (hasWeeds) result.needWeed.push(id);

      const insectTime = toTimeSec(currentPhase.insect_time);
      const hasBugs = (plant.insect_owners && plant.insect_owners.length > 0) || (insectTime > 0 && insectTime <= nowSec);
      if (hasBugs) result.needBug.push(id);

      result.growing.push(id);
    }

    return result;
  }

  getCurrentPhase(phases: PlantPhaseInfo[], debug = false, landLabel = ''): PlantPhaseInfo | null {
    if (!phases || phases.length === 0) return null;
    const nowSec = getServerTimeSec();

    if (debug) {
      console.warn(`    ${landLabel} 服务器时间=${nowSec} (${new Date(nowSec * 1000).toLocaleTimeString()})`);
      for (let i = 0; i < phases.length; i++) {
        const p = phases[i];
        const bt = toTimeSec(p.beginTime);
        const phaseName = PHASE_NAMES[p.phase] || `阶段${p.phase}`;
        const diff = bt > 0 ? bt - nowSec : 0;
        const diffStr = diff > 0 ? `(未来 ${diff}s)` : diff < 0 ? `(已过 ${-diff}s)` : '';
        console.warn(
          `    ${landLabel}   [${i}] ${phaseName}(${p.phase}) begin=${bt} ${diffStr} dry=${toTimeSec(p.dry_time)} weed=${toTimeSec(p.weeds_time)} insect=${toTimeSec(p.insect_time)}`
        );
      }
    }

    for (let i = phases.length - 1; i >= 0; i--) {
      const beginTime = toTimeSec(phases[i].beginTime);
      if (beginTime > 0 && beginTime <= nowSec) {
        if (debug) {
          console.warn(`    ${landLabel}   → 当前阶段: ${PHASE_NAMES[phases[i].phase] || phases[i].phase}`);
        }
        return phases[i];
      }
    }

    if (debug) {
      console.warn(`    ${landLabel}   → 所有阶段都在未来，使用第一个: ${PHASE_NAMES[phases[0].phase] || phases[0].phase}`);
    }
    return phases[0];
  }

  buildLandMap(lands: LandEntity[]): Map<number, LandEntity> {
    const map = new Map<number, LandEntity>();
    for (const land of lands) {
      if (land.id > 0) map.set(land.id, land);
    }
    return map;
  }

  getLandLifecycleState(land: LandEntity): 'empty' | 'dead' | 'growing' | 'unknown' {
    if (!land.hasPlant) return 'empty';
    const currentPhase = this.getCurrentPhase(land.plant!.phases);
    if (!currentPhase) return 'empty';
    const phaseVal = currentPhase.phase;
    if (phaseVal === PlantPhase.DEAD) return 'dead';
    if (phaseVal === PlantPhase.UNKNOWN) return 'empty';
    if (phaseVal >= PlantPhase.SEED && phaseVal <= PlantPhase.MATURE) return 'growing';
    return 'unknown';
  }

  classifyHarvestedLandsByMap(landIds: number[], landsMap: Map<number, LandEntity>): { removable: number[]; growing: number[]; unknown: number[] } {
    const removable: number[] = [];
    const growing: number[] = [];
    const unknown: number[] = [];

    for (const id of landIds) {
      const land = landsMap.get(id);
      if (!land) {
        unknown.push(id);
        continue;
      }
      const state = this.getLandLifecycleState(land);
      if (state === 'dead' || state === 'empty') {
        removable.push(id);
      } else if (state === 'growing') {
        growing.push(id);
      } else {
        unknown.push(id);
      }
    }

    return { removable, growing, unknown };
  }

  getDisplayLandContext(land: LandEntity, landsMap: Map<number, LandEntity>): { sourceLand: LandEntity | null; occupiedByMaster: boolean; masterLandId: number; occupiedLandIds: number[] } {
    const landId = land.id;
    const masterLandId = land.masterLandId;
    if (masterLandId > 0 && masterLandId !== landId) {
      const masterLand = landsMap.get(masterLandId);
      if (masterLand && masterLand.slaveLandIds && masterLand.slaveLandIds.length > 0) {
        if (masterLand.slaveLandIds.includes(landId)) {
          const occupiedLandIds = [masterLandId, ...masterLand.slaveLandIds].filter((id) => id > 0);
          return { sourceLand: masterLand, occupiedByMaster: true, masterLandId, occupiedLandIds };
        }
      }
    }

    return { sourceLand: land, occupiedByMaster: false, masterLandId: landId, occupiedLandIds: [landId].filter((id) => id > 0) };
  }

  summarizeLandDetails(lands: LandEntity[]): {
    harvestable: number;
    growing: number;
    empty: number;
    dead: number;
    needWater: number;
    needWeed: number;
    needBug: number;
  } {
    const summary = { harvestable: 0, growing: 0, empty: 0, dead: 0, needWater: 0, needWeed: 0, needBug: 0 };

    for (const land of lands) {
      if (!land.unlocked) continue;
      const status = land.status;
      if (status === 'harvestable') summary.harvestable++;
      else if (status === 'dead') summary.dead++;
      else if (status === 'empty') summary.empty++;
      else if (status === 'growing' || status === 'stealable' || status === 'harvested') summary.growing++;

      // these flags would need to be computed externally or stored on the entity
    }

    return summary;
  }
}
