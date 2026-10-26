import { describe, expect, it } from 'vitest';
import { splitShares, weightsFromPercent } from './split';

describe('splitShares', () => {
  it('equal weights give 50/50', () => {
    const s = splitShares([
      { user_id: 'a', split_weight: 1 },
      { user_id: 'b', split_weight: 1 },
    ]);
    expect(s.get('a')).toBe(0.5);
    expect(s.get('b')).toBe(0.5);
  });

  it('uneven weights', () => {
    const s = splitShares([
      { user_id: 'a', split_weight: 60 },
      { user_id: 'b', split_weight: 40 },
    ]);
    expect(s.get('a')).toBeCloseTo(0.6);
  });
});

describe('weightsFromPercent', () => {
  it('clamps and complements', () => {
    expect(weightsFromPercent(50)).toEqual([50, 50]);
    expect(weightsFromPercent(0)).toEqual([1, 99]);
    expect(weightsFromPercent(150)).toEqual([99, 1]);
  });
});
