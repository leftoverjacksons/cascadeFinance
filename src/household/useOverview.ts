import { useCallback, useEffect, useState } from 'react';
import { todayLocal } from '../domain/dates';
import { monthEnd, monthRange, type BalancePoint, type CategoryTotal } from '../domain/summary';
import { supabase } from '../lib/supabase';

/** Months of history fetched; period choices on screen are subsets of it. */
export const HISTORY_MONTHS = 24;

export interface OverviewData {
  today: string;
  months: string[];
  totals: CategoryTotal[];
  /** Balances at each month end (today for the current month). */
  balances: BalancePoint[];
}

/** Balance dates: each month's last day, except the current month uses today. */
export function balanceDates(months: string[], today: string): string[] {
  return months.map((m) => (monthEnd(m) > today ? today : monthEnd(m)));
}

export function useOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const today = todayLocal();
    const months = monthRange(today, HISTORY_MONTHS);
    const [totals, balances] = await Promise.all([
      supabase.rpc('monthly_category_totals', { p_from: months[0], p_to: today }),
      supabase.rpc('balance_history', { p_dates: balanceDates(months, today) }),
    ]);
    if (totals.error || balances.error) {
      setError((totals.error ?? balances.error)!.message);
      return;
    }
    setError(null);
    setData({ today, months, totals: totals.data, balances: balances.data });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, refresh };
}
