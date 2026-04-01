export interface PlantPhaseInfo {
  phase: number;
  beginTime: number;
  endTime?: number;
  dry_time?: number;
  weeds_time?: number;
  insect_time?: number;
  ferts_used?: Record<string, number>;
}

export interface PlantData {
  id: number;
  name?: string;
  phases: PlantPhaseInfo[];
  season?: number;
  dry_num?: number;
  weed_owners?: number[];
  insect_owners?: number[];
  stealable?: boolean;
  left_inorc_fert_times?: number;
  ferts_used?: Record<string, number>;
}

export class LandEntity {
  constructor(
    public readonly id: number,
    public unlocked: boolean,
    public level: number = 0,
    public maxLevel: number = 0,
    public landsLevel: number = 0,
    public landSize: number = 0,
    public couldUnlock: boolean = false,
    public couldUpgrade: boolean = false,
    public plant: PlantData | null = null,
    public masterLandId: number = 0,
    public slaveLandIds: number[] = [],
    public status: string = ''
  ) {}

  get isOccupiedByMaster(): boolean {
    return this.masterLandId > 0 && this.masterLandId !== this.id;
  }

  get hasPlant(): boolean {
    return this.plant !== null && Array.isArray(this.plant.phases) && this.plant.phases.length > 0;
  }
}
