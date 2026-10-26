// Shared-expense split between household members (docs/DESIGN.md §9a).
// Each member has a positive weight; a member's share = weight / sum(weights).

export interface WeightedMember {
  user_id: string;
  split_weight: number;
}

export function splitShares(members: WeightedMember[]): Map<string, number> {
  const total = members.reduce((sum, m) => sum + m.split_weight, 0);
  const shares = new Map<string, number>();
  if (total <= 0) return shares;
  for (const m of members) shares.set(m.user_id, m.split_weight / total);
  return shares;
}

/**
 * Converts a percentage for one member of a two-person household into weights
 * for both. E.g. 60 -> [60, 40]. Clamped to the open interval (0, 100).
 */
export function weightsFromPercent(percentForFirst: number): [number, number] {
  const p = Math.min(99, Math.max(1, Math.round(percentForFirst)));
  return [p, 100 - p];
}
