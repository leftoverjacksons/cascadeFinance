import { describe, expect, it } from 'vitest';
import type { Category } from './categories';
import {
  averages,
  monthEnd,
  monthRange,
  netWorthByDate,
  OTHER,
  seriesValues,
  summarise,
  topGroups,
  UNCATEGORIZED,
} from './summary';

function cat(id: string, kind: Category['kind'], parent_id: string | null = null): Category {
  return { id, name: id, kind, parent_id, household_id: 'h', is_archived: false, sort_order: 0, created_at: '' };
}

const cats = [
  cat('food', 'expense'),
  cat('groceries', 'expense', 'food'),
  cat('dining', 'expense', 'food'),
  cat('shopping', 'expense'),
  cat('clothes', 'expense', 'shopping'),
  cat('income', 'income'),
  cat('pay', 'income', 'income'),
  cat('transfers', 'transfer'),
  cat('between', 'transfer', 'transfers'),
];
const byId = new Map(cats.map((c) => [c.id, c]));

describe('monthRange / monthEnd', () => {
  it('spans year boundaries', () => {
    expect(monthRange('2026-02-14', 4)).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']);
  });
  it('knows month lengths', () => {
    expect(monthEnd('2026-02-01')).toBe('2026-02-28');
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
    expect(monthEnd('2026-12-01')).toBe('2026-12-31');
  });
});

describe('summarise', () => {
  const months = ['2026-09-01', '2026-10-01'];
  const rows = [
    { month: '2026-10-01', category_id: 'groceries', inflow_cents: 2000, outflow_cents: -13770 },
    { month: '2026-10-01', category_id: 'dining', inflow_cents: 0, outflow_cents: -5000 },
    { month: '2026-10-01', category_id: 'pay', inflow_cents: 317628, outflow_cents: 0 },
    { month: '2026-10-01', category_id: 'between', inflow_cents: 100000, outflow_cents: -100000 },
    { month: '2026-10-01', category_id: null, inflow_cents: 1500, outflow_cents: -999 },
    { month: '2026-09-01', category_id: 'clothes', inflow_cents: 0, outflow_cents: -4000 },
    { month: '2026-08-01', category_id: 'clothes', inflow_cents: 0, outflow_cents: -9999 },
  ];
  const [sep, oct] = summarise(rows, byId, months);

  it('nets refunds, excludes transfers, splits uncategorised by direction', () => {
    expect(oct.spending).toBe(13770 - 2000 + 5000 + 999);
    expect(oct.income).toBe(317628 + 1500);
  });
  it('rolls categories up to their group', () => {
    expect(oct.byGroup.get('food')).toBe(11770 + 5000);
    expect(oct.byGroup.get(UNCATEGORIZED)).toBe(999);
    expect(oct.byCategory.get('groceries')).toBe(11770);
  });
  it('ignores months outside the range and keeps empty months', () => {
    expect(sep.spending).toBe(4000);
    expect(summarise([], byId, months).map((s) => s.spending)).toEqual([0, 0]);
  });

  it('averages, top groups and series folding', () => {
    expect(averages([sep, oct])).toEqual({
      income: Math.round((317628 + 1500) / 2),
      spending: Math.round((4000 + 17769) / 2),
      net: Math.round((317628 + 1500) / 2 - (4000 + 17769) / 2),
      months: 2,
    });
    expect(topGroups([sep, oct], 1)).toEqual(['food']);
    const v = seriesValues(oct, ['food', OTHER]);
    expect(v.get('food')).toBe(16770);
    expect(v.get(OTHER)).toBe(999);
  });
});

describe('netWorthByDate', () => {
  it('sums signed balances per date', () => {
    const nw = netWorthByDate([
      { account_id: 'a', as_of: '2026-10-31', balance_cents: 100000, anchor_date: '' },
      { account_id: 'b', as_of: '2026-10-31', balance_cents: -50000, anchor_date: '' },
      { account_id: 'a', as_of: '2026-09-30', balance_cents: 90000, anchor_date: '' },
    ]);
    expect(nw.get('2026-10-31')).toBe(50000);
    expect(nw.get('2026-09-30')).toBe(90000);
  });
});
