// Recurring charges (docs/DESIGN.md: Recurring charges).
//
// Money out is grouped by merchant (merchantKey, as on the money-flow
// diagram) and split into series that each keep to one cadence (weekly ...
// yearly), so two subscriptions to the same service (e.g. one each) are two
// series. Amounts may be fixed or vary (utilities); both count, and are
// labelled.
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

/** Within this share of the typical amount, an amount counts as "the same". */
const SAME_AMOUNT = 0.1;
/** Overdue by more than this share of a cadence: "may have stopped". */
const OVERDUE = 0.5;
/** Series whose last charge is older than this are history, not shown. */
const FORGOTTEN_DAYS = 365;
/** A series whose amount varies needs this many charges (a bill has a long history; a few visits to a shop do not). */
const MIN_VARYING = 6;

export interface RecurringSeries {
  /** Unique per series (a merchant can have several, e.g. one per person). */
  key: string;
  /** The merchant (merchantKey); what "not recurring" hides. */
  merchantKey: string;
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

/** Share of a merchant's charges a cadence must explain (the rest is ordinary shopping). */
const EXPLAINED = 0.75;

/**
 * Splits a merchant's charges (oldest first) into series at one cadence. Each
 * charge joins the series whose next charge was due closest to it (one
 * skipped charge allowed; amount breaks ties), or starts a new series. So two
 * people's subscriptions to one service, interleaved or paid from the same
 * account, come out as two series; a subscription that moves to another
 * account stays one.
 */
function chains(txns: RecurringInput[], spec: CadenceSpec): RecurringInput[][] {
  const out: RecurringInput[][] = [];
  for (const t of txns) {
    let best = -1;
    let bestScore = Infinity;
    out.forEach((chain, i) => {
      const last = chain[chain.length - 1];
      const gap = days(last.posted_on, t.posted_on);
      const due = gap >= spec.min && gap <= spec.max ? spec.days : gap >= 2 * spec.min && gap <= 2 * spec.max ? 2 * spec.days : null;
      if (due === null) return;
      const amountDiff = Math.abs(t.amount_cents - last.amount_cents) / Math.max(100, -last.amount_cents);
      const score = Math.abs(gap - due) + 10 * amountDiff;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) out[best].push(t);
    else out.push([t]);
  }
  return out.filter((chain) => chain.length >= spec.minCount);
}

/**
 * Recurring charges among `transactions` (money out only; callers leave out
 * transfers between the household's own accounts). Largest monthly cost first.
 *
 * Per merchant, the cadence that explains the most charges with the fewest
 * series wins, and must explain at least 75 % of them.
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
    const txns = [...all].sort((a, b) => a.posted_on.localeCompare(b.posted_on) || a.id.localeCompare(b.id));
    // Best cadence: explains the most charges, then with the fewest series,
    // then with the fewest assumed skips (monthly charges also look like
    // "every 2 weeks, every other one skipped").
    let best: { spec: CadenceSpec; series: RecurringInput[][]; covered: number; skips: number } | null = null;
    for (const spec of CADENCES) {
      const series = chains(txns, spec);
      const covered = series.reduce((t, c) => t + c.length, 0);
      const skips = series.reduce(
        (t, c) => t + c.slice(1).filter((x, i) => days(c[i].posted_on, x.posted_on) > spec.max).length,
        0,
      );
      const better =
        !best ||
        covered > best.covered ||
        (covered === best.covered &&
          (series.length < best.series.length || (series.length === best.series.length && skips < best.skips)));
      if (better) best = { spec, series, covered, skips };
    }
    if (!best) continue;
    const { spec } = best;
    // Several series from one merchant must each have a steady price (two
    // people's subscriptions); varying amounts that merely line up are
    // ordinary shopping. A single series may vary (utilities).
    const steady = (chain: RecurringInput[]) => {
      const typical = median(chain.map((t) => -t.amount_cents));
      return chain.every((t) => Math.abs(-t.amount_cents - typical) <= typical * SAME_AMOUNT);
    };
    const kept = best.series.length > 1 ? best.series.filter(steady) : best.series;
    const covered = kept.reduce((t, c) => t + c.length, 0);
    if (covered === 0 || covered / txns.length < EXPLAINED) continue;

    kept.forEach((chain, n) => {
      const amounts = chain.map((t) => -t.amount_cents);
      const typicalCents = Math.round(median(amounts));
      const varies = amounts.some((a) => Math.abs(a - typicalCents) > typicalCents * SAME_AMOUNT);
      const last = chain[chain.length - 1].posted_on;
      const next = addDays(last, spec.days);
      const accountId = mode(chain.map((t) => t.account_id));
      if (varies && chain.length < MIN_VARYING) return;
      if (days(last, dataUntil(accountId)) > FORGOTTEN_DAYS) return;
      out.push({
        key: kept.length > 1 ? `${key}~${n}` : key,
        merchantKey: key,
        label: mode(chain.map((t) => t.display_description.trim())),
        cadence: spec.cadence,
        typicalCents,
        monthlyCents: Math.round((typicalCents * 30.44) / spec.days),
        varies,
        first: chain[0].posted_on,
        last,
        next,
        overdue: days(next, dataUntil(accountId)) > spec.days * OVERDUE,
        categoryId: mode(chain.map((t) => t.category_id)),
        accountId,
        transactions: [...chain].reverse(),
      });
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
