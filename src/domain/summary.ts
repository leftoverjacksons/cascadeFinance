// Turns monthly per-category totals into the Overview's figures.
//
// Conventions (docs/DESIGN.md §8):
//   * Transfer-kind categories are excluded from income and spending.
//   * Expense categories are netted: a refund reduces that category's spending.
//   * Income categories are netted the same way.
//   * Uncategorised rows count by direction: money out is spending, money in is income.
import type { Category } from './categories';

export interface CategoryTotal {
  month: string; // YYYY-MM-01
  category_id: string | null;
  inflow_cents: number;
  outflow_cents: number; // negative or zero
}

export const UNCATEGORIZED = 'uncategorized';

export interface MonthSummary {
  month: string;
  income: number;
  spending: number;
  /** Spending per group id (or UNCATEGORIZED), in cents, positive = money spent. */
  byGroup: Map<string, number>;
  /** Spending per category id (children and groups used directly). */
  byCategory: Map<string, number>;
}

/** First-of-month dates, ascending, ending with the month containing `end`. */
export function monthRange(end: string, count: number): string[] {
  const [y, m] = end.split('-').map(Number);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(d.toISOString().slice(0, 10));
  }
  return months;
}

/** Last calendar day of the month starting at `month` (YYYY-MM-01). */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function add(map: Map<string, number>, key: string, cents: number) {
  map.set(key, (map.get(key) ?? 0) + cents);
}

export function summarise(rows: CategoryTotal[], byId: Map<string, Category>, months: string[]): MonthSummary[] {
  const result = new Map<string, MonthSummary>(
    months.map((month) => [month, { month, income: 0, spending: 0, byGroup: new Map(), byCategory: new Map() }]),
  );
  for (const r of rows) {
    const s = result.get(r.month);
    if (!s) continue;
    if (r.category_id === null) {
      s.income += r.inflow_cents;
      const spent = -r.outflow_cents;
      s.spending += spent;
      if (spent) add(s.byGroup, UNCATEGORIZED, spent);
      continue;
    }
    const category = byId.get(r.category_id);
    if (!category) continue;
    const net = r.inflow_cents + r.outflow_cents;
    if (category.kind === 'income') s.income += net;
    else if (category.kind === 'expense') {
      s.spending += -net;
      add(s.byGroup, category.parent_id ?? category.id, -net);
      add(s.byCategory, category.id, -net);
    }
  }
  return months.map((m) => result.get(m)!);
}

export interface Averages {
  income: number;
  spending: number;
  net: number;
  months: number;
}

/** Monthly averages over the given summaries (callers exclude a partial month). */
export function averages(summaries: MonthSummary[]): Averages {
  const n = summaries.length;
  if (n === 0) return { income: 0, spending: 0, net: 0, months: 0 };
  const income = summaries.reduce((t, s) => t + s.income, 0) / n;
  const spending = summaries.reduce((t, s) => t + s.spending, 0) / n;
  return { income: Math.round(income), spending: Math.round(spending), net: Math.round(income - spending), months: n };
}

export const OTHER = 'other';

/**
 * The `limit` groups with the most spending over the period, in descending
 * order. Everything else folds into OTHER so a chart never needs more than
 * `limit + 1` colours.
 */
export function topGroups(summaries: MonthSummary[], limit: number): string[] {
  const totals = new Map<string, number>();
  for (const s of summaries) for (const [g, v] of s.byGroup) add(totals, g, v);
  return [...totals.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([g]) => g);
}

/** Spending per series (top groups + OTHER) for one month. */
export function seriesValues(summary: MonthSummary, series: string[]): Map<string, number> {
  const out = new Map(series.map((s) => [s, 0]));
  const hasOther = series.includes(OTHER);
  for (const [g, v] of summary.byGroup) {
    if (out.has(g)) add(out, g, v);
    else if (hasOther) add(out, OTHER, v);
  }
  return out;
}

export interface BalancePoint {
  account_id: string;
  as_of: string;
  balance_cents: number; // signed: liabilities negative
  anchor_date: string;
}

/** Net worth per date: assets minus liabilities, over accounts that have a balance. */
export function netWorthByDate(points: BalancePoint[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) add(out, p.as_of, p.balance_cents);
  return out;
}
