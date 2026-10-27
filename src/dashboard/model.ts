import { useMemo } from 'react';
import type { Account } from '../domain/accounts';
import type { Category } from '../domain/categories';
import {
  averages,
  netWorthByDate,
  OTHER,
  seriesValues,
  summarise,
  topGroups,
  UNCATEGORIZED,
  type Averages,
  type BalancePoint,
  type MonthSummary,
} from '../domain/summary';
import { balanceDates, type OverviewData } from '../household/useOverview';

/** Spending chart shows this many groups; the rest fold into "Other". */
export const TOP_GROUPS = 6;
export const PERIODS = [6, 12, 24] as const;

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

export function monthLabel(month: string, index: number): string {
  const label = monthFmt.format(new Date(`${month}T00:00:00Z`));
  return index === 0 || month.endsWith('-01-01') ? `${label} ’${month.slice(2, 4)}` : label;
}

/** Everything the Overview panels display, derived once and shared by all panels. */
export interface DashboardModel {
  data: OverviewData;
  accounts: Account[];
  byId: Map<string, Category>;
  /** Months in the selected period, oldest first; the last is the current (partial) month. */
  shown: MonthSummary[];
  labels: string[];
  current?: MonthSummary;
  lastMonth?: MonthSummary;
  /** Full months in the period (the averages' basis). */
  complete: MonthSummary[];
  avg: Averages;
  /** Spending-chart series: group ids (stable over the full history) plus OTHER. */
  series: string[];
  groupName: (g: string) => string;
  /** Balance dates in the period (month ends; today for the current month). */
  dates: string[];
  netWorth: Map<string, number>;
  todayBalances: BalancePoint[];
  hasBalances: boolean;
}

export function useDashboardModel(
  data: OverviewData | null,
  byId: Map<string, Category>,
  accounts: Account[],
  period: number,
): DashboardModel | null {
  const all = useMemo(() => (data ? summarise(data.totals, byId, data.months) : []), [data, byId]);
  // Series are chosen over the full fetched history, so changing the period
  // never repaints a group in a different colour.
  const series = useMemo(() => {
    const top = topGroups(all, TOP_GROUPS);
    const hasRest = all.some((s) => [...s.byGroup.keys()].some((g) => !top.includes(g)));
    return hasRest ? [...top, OTHER] : top;
  }, [all]);

  return useMemo(() => {
    if (!data) return null;
    const shown = all.slice(-period);
    const complete = shown.slice(0, -1);
    const groupName = (g: string) =>
      g === OTHER ? 'Other' : g === UNCATEGORIZED ? 'Uncategorized' : (byId.get(g)?.name ?? '—');
    return {
      data,
      accounts,
      byId,
      shown,
      labels: shown.map((s, i) => monthLabel(s.month, i) + (i === shown.length - 1 ? ' (so far)' : '')),
      current: shown[shown.length - 1],
      lastMonth: complete[complete.length - 1],
      complete,
      avg: averages(complete.length > 0 ? complete : shown),
      series,
      groupName,
      dates: balanceDates(data.months, data.today).slice(-period),
      netWorth: netWorthByDate(data.balances),
      todayBalances: data.balances.filter((b) => b.as_of === data.today),
      hasBalances: data.balances.length > 0,
    };
  }, [data, all, series, period, byId, accounts]);
}

/** Per-series spending for a month; 0 when the month is absent. */
export function groupValue(model: DashboardModel, g: string) {
  return (s?: MonthSummary) => (s ? (seriesValues(s, model.series).get(g) ?? 0) : 0);
}

/** Average of a per-month value over the model's full months (or all shown months if none). */
export function averageOf(model: DashboardModel, f: (s?: MonthSummary) => number): number {
  const base = model.complete.length > 0 ? model.complete : model.shown;
  return base.reduce((t, s) => t + f(s), 0) / Math.max(base.length, 1);
}
