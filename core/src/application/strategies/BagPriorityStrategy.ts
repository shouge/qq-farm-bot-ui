import type { ISeedSelectionStrategy, SeedInfo } from './ISeedSelectionStrategy';
import type { UserStateSnapshot } from '../../domain/ports/INetworkClient';

export class BagPriorityStrategy implements ISeedSelectionStrategy {
  constructor(private readonly priority: number[]) {}

  selectSeed(availableSeeds: SeedInfo[], _state: UserStateSnapshot): SeedInfo | null {
    if (availableSeeds.length === 0) return null;
    if (this.priority.length === 0) {
      const sorted = [...availableSeeds].sort((a, b) => b.requiredLevel - a.requiredLevel);
      return sorted[0];
    }

    const priorityMap = new Map<number, number>();
    this.priority.forEach((seedId, index) => {
      priorityMap.set(seedId, index);
    });

    const sorted = [...availableSeeds].sort((a, b) => {
      const pa = priorityMap.has(a.seedId) ? priorityMap.get(a.seedId)! : Number.MAX_SAFE_INTEGER;
      const pb = priorityMap.has(b.seedId) ? priorityMap.get(b.seedId)! : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return b.requiredLevel - a.requiredLevel;
    });

    return sorted[0];
  }
}
