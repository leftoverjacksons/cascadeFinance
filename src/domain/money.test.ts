import { describe, expect, it } from 'vitest';
import { formatCents, parseAmountToCents } from './money';

describe('parseAmountToCents', () => {
  it.each([
    ['0', 0],
    ['12', 1200],
    ['12.5', 1250],
    ['12.05', 1205],
    ['-38.75', -3875],
    ['$1,234.56', 123456],
    ['-$1,234.56', -123456],
    ['(12.00)', -1200],
    ['.99', 99],
    ['  3176.28 ', 317628],
    ['-0.00', 0],
  ])('%s -> %i', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });

  it.each(['', 'abc', '1.234', '1.2.3', '--5', '$', '12e3'])('rejects %j', (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });

  it('is exact where float arithmetic is not', () => {
    // 0.1 + 0.2 style errors must not appear: 1641 rows of -0.07 sum exactly.
    expect(parseAmountToCents('-0.07')! * 1641).toBe(-11487);
  });
});

describe('formatCents', () => {
  it('formats USD', () => {
    expect(formatCents(-13770)).toBe('-$137.70');
    expect(formatCents(317628)).toBe('$3,176.28');
  });
});
