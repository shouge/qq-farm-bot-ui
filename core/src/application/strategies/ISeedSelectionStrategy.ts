import type { UserStateSnapshot } from '../../domain/ports/INetworkClient';

export interface SeedInfo {
  goodsId: number;
  seedId: number;
  price: number;
  requiredLevel: number;
  name?: string;
  plantId?: number;
}

export interface ISeedSelectionStrategy {
  selectSeed: (availableSeeds: SeedInfo[], state: UserStateSnapshot) => SeedInfo | null;
}
