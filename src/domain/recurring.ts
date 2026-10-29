// Recurring charges (docs/DESIGN.md: Recurring charges).
//
// Money out is grouped by merchant (merchantKey, as on the money-flow
// diagram). A merchant is a recurring charge when the gaps between its charges
// are consistent with one cadence (weekly ... yearly). Amounts may be fixed or
// vary (utilities); both count, and are labelled.
import { merchantKey } from './flows';

export interface RecurringInput {
  id: string;
  /** YYYY-MM-DD */
  posted_on: string;
  /** Negative: money out. */
  amount_cents: number;
  display_description: string;
  category_id: string | null;
  account_id: string;
}

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

interface CadenceSpec {
  cadence: Cadence;
  /** Typical gap in days, and the range of gaps that count as this cadence. */
  days: number;
  min: number;
  max: number;
  /** Fewest charges that establish it. */
  minCount: number;
}

export const CADENCES: CadenceSpec[] = [
  { cadence: 'weekly', days: 7, min: 5, max: 9, minCount: 3 },
  { cadence: 'biweekly', days: 14, min: 12, max: 16, minCount: 3 },
  { cadence: 'monthly', days: 30.44, min: 26, max: 35, minCount: 3 },
  { cadence: 'quarterly', days: 91.3, min: 80, max: 100, minCount: 3 },
  { cadence: 'yearly', days: 365.25, min: 350, max: 380, minCount: 2 },
];

/** Share of gaps that must fit the cadence (one skipped or late charge is fine). */
const REGULAR = 0.75;
/** Within this share of the typical amount, an amount counts as "the same". */
const SAME_AMOUNT = 0.1;
/** Overdue by more than this share of a cadence: "may have stopped". */
const OVERDUE = 0.5;

export interface RecurringSeries {
  key: string;
  label: string;
  cadence: Cadence;
  /** Typical charge (median), positive cents. */
  typicalCents: number;
  /** The same per month, for comparing cadences. */
  monthlyCents: number;
  /** Amounts differ by more than 10% from the typical one (e.g. utilities). */
  varies: boolean;
  first: string;
  last: string;
  /** When the next charge is expected. */
  next: string;
  /** The expected charge is overdue: the subscription may have stopped. */
  overdue: boolean;
  categoryId: string | null;
  accountId: string;
  /** Newest first. */
  transactions: RecurringInput[];
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + Math.round(n) * DAY).toISOString().slice(0, 10);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Most common value (ties: the first seen). */
const mode = <T>(xs: T[]) => {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
};

/**
 * Recurring charges among `transactions` (money out only; callers leave out
 * transfers between the household's own accounts). Largest monthly cost first.
 *
 * `asOf` is the date data is complete to: a date, or per account (the newest
 * data imported for it), so a series is not called overdue just because its
 * account has not been imported lately.
 */
export function detectRecurring(
  transactions: RecurringInput[],
  asOf: string | ((accountId: string) => string),
): RecurringSeries[] {
  const dataUntil = typeof asOf === 'string' ? () => asOf : asOf;
  const byMerchant = new Map<string, RecurringInput[]>();
  for (const t of transactions) {
    if (t.amount_cents >= 0) continue;
    const key = merchantKey(t.display_description);
    if (!key) continue;
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), t]);
  }

  const out: RecurringSeries[] = [];
  for (const [key, all] of byMerchant) {
    const txns = [...all].sort((a, b) => a.posted_on.localeCompare(b.posted_on));
    // Several charges on one day (e.g. two coffees) are one occasion.
    const dates = [...new Set(txns.map((t) => t.posted_on))];
    if (dates.length < 2) continue;
    const gaps = dates.slice(1).map((d, i) => days(dates[i], d));
    const typicalGap = median(gaps);
    const spec = CADENCES.find((c) => typicalGap >= c.min && typicalGap <= c.max);
    if (!spec || dates.length < spec.minCount) continue;
    const fitting = gaps.filter((g) => g >= spec.min && g <= spec.max).length;
    if (fitting / gaps.length < REGULAR) continue;

    const amounts = txns.map((t) => -t.amount_cents);
    const typicalCents = Math.round(median(amounts));
    const varies = amounts.some((a) => Math.abs(a - typicalCents) > typicalCents * SAME_AMOUNT);
    const last = dates[dates.length - 1];
    const next = addDays(last, spec.days);
    const accountId = mode(txns.map((t) => t.account_id));
    out.push({
      key,
      label: mode(txns.map((t) => t.display_description.trim())),
      cadence: spec.cadence,
      typicalCents,
      monthlyCents: Math.round((typicalCents * 30.44) / spec.days),
      varies,
      first: dates[0],
      last,
      next,
      overdue: days(next, dataUntil(accountId)) > spec.days * OVERDUE,
      categoryId: mode(txns.map((t) => t.category_id)),
      accountId,
      transactions: [...txns].reverse(),
    });
  }
  return out.sort((a, b) => b.monthlyCents - a.monthlyCents || a.label.localeCompare(b.label));
}

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};
