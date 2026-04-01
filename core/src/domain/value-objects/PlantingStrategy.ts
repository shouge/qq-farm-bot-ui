export const PLANTING_STRATEGIES = [
  'preferred',
  'level',
  'bag_priority',
  'max_exp',
  'max_fert_exp',
  'max_profit',
  'max_fert_profit',
] as const;

export type PlantingStrategy = (typeof PLANTING_STRATEGIES)[number];

export function isValidPlantingStrategy(value: string): value is PlantingStrategy {
  return PLANTING_STRATEGIES.includes(value as PlantingStrategy);
}
