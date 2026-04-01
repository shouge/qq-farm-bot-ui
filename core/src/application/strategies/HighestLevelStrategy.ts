import type { ISeedSelectionStrategy, SeedInfo } from './ISeedSelectionStrategy';
import type { UserStateSnapshot } from '../../domain/ports/INetworkClient';

export class HighestLevelStrategy implements ISeedSelectionStrategy {
  selectSeed(availableSeeds: SeedInfo[], _state: UserStateSnapshot): SeedInfo | null {
    if (availableSeeds.length === 0) return null;
    const sorted = [...availableSeeds].sort((a, b) => b.requiredLevel - a.requiredLevel);
    return sorted[0];
  }
}
