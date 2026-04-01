import type { ISeedSelectionStrategy, SeedInfo } from './ISeedSelectionStrategy';
import type { UserStateSnapshot } from '../../domain/ports/INetworkClient';

export class PreferredSeedStrategy implements ISeedSelectionStrategy {
  constructor(private readonly preferredSeedId: number) {}

  selectSeed(availableSeeds: SeedInfo[], _state: UserStateSnapshot): SeedInfo | null {
    if (this.preferredSeedId <= 0) return null;
    return availableSeeds.find((s) => s.seedId === this.preferredSeedId) || null;
  }
}
