import { describe, expect, it } from 'vitest';
import { balanceBetween, monthlyBreakdown, whoOwes, type LedgerEntry } from './shared';

const A = 'a';
const B = 'b';
const e = (p: Partial<LedgerEntry>): LedgerEntry => ({
  entry_kind: 'expense',
  entry_date: '2026-10-01',
  ref_id: Math.random().toString(),
  description: '',
  total_cents: 0,
  debtor: B,
  creditor: A,
  cents: 0,
  ...p,
});

const entries = [
  e({ ref_id: 'kroger', total_cents: 10000, cents: 5000 }), // A paid groceries; B owes half
  e({ ref_id: 'publix', total_cents: 8000, cents: 4000, debtor: A, creditor: B, entry_date: '2026-10-07' }),
  e({ ref_id: 'refund', total_cents: -1000, cents: -500 }),
  e({ entry_kind: 'payback', ref_id: 'p1', total_cents: 30000, cents: 30000, entry_date: '2026-09-14' }),
  e({ entry_kind: 'manual', ref_id: 'm1', total_cents: 20000, cents: 20000, debtor: A, creditor: B, entry_date: '2026-09-30' }),
];

describe('balanceBetween / whoOwes', () => {
  it('nets entries in both directions', () => {
    // 5000 - 4000 - 500 + 30000 - 20000
    expect(balanceBetween(entries, A, B)).toBe(10500);
    expect(balanceBetween(entries, B, A)).toBe(-10500);
  });
  it('reports the debtor and creditor', () => {
    expect(whoOwes(entries, A, B)).toEqual({ debtor: B, creditor: A, cents: 10500 });
    expect(whoOwes(entries, B, A)).toEqual({ debtor: B, creditor: A, cents: 10500 });
    expect(whoOwes([], A, B)).toBeNull();
  });
});

describe('monthlyBreakdown', () => {
  const months = monthlyBreakdown(entries, A, B);
  it('is newest first', () => {
    expect(months.map((m) => m.month)).toEqual(['2026-10-01', '2026-09-01']);
  });
  it('totals shared spending by payer and paybacks by payer', () => {
    const [oct, sep] = months;
    expect(oct.paidBy.get(A)).toBe(10000 - 1000);
    expect(oct.paidBy.get(B)).toBe(8000);
    expect(oct.change).toBe(5000 - 4000 - 500);
    expect(sep.paidBack.get(A)).toBe(30000);
    expect(sep.paidBack.get(B)).toBe(20000);
    expect(sep.change).toBe(10000);
  });
  it('counts an expense once even when it has a row per other member', () => {
    const three = [
      e({ ref_id: 'x', total_cents: 9000, cents: 3000, debtor: B }),
      e({ ref_id: 'x', total_cents: 9000, cents: 3000, debtor: 'c' }),
    ];
    expect(monthlyBreakdown(three, A, B)[0].paidBy.get(A)).toBe(9000);
  });
});
