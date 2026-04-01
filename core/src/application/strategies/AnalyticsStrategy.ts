import type { ISeedSelectionStrategy, SeedInfo } from './ISeedSelectionStrategy';
import type { UserStateSnapshot } from '../../domain/ports/INetworkClient';
import { getPlantRankings } from '../../services/analytics';

export type AnalyticsSortBy = 'exp' | 'fert' | 'profit' | 'fert_profit';

export class AnalyticsStrategy implements ISeedSelectionStrategy {
  constructor(private readonly sortBy: AnalyticsSortBy) {}

  selectSeed(availableSeeds: SeedInfo[], state: UserStateSnapshot): SeedInfo | null {
    if (availableSeeds.length === 0) return null;
    try {
      const rankings = getPlantRankings(this.sortBy);
      const availableBySeedId = new Map(availableSeeds.map((s) => [s.seedId, s]));

      for (const row of rankings) {
        const seedId = Number(row?.seedId) || 0;
        if (seedId <= 0) continue;
        const lv = Number(row?.level);
        if (Number.isFinite(lv) && lv > state.level) continue;
        const found = availableBySeedId.get(seedId);
        if (found) return found;
      }
    } catch {
      // fall through
    }

    // fallback to highest level
    const sorted = [...availableSeeds].sort((a, b) => b.requiredLevel - a.requiredLevel);
    return sorted[0];
  }
}
