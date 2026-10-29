import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayLocal } from '../domain/dates';
import { detectRecurring, type RecurringInput, type RecurringSeries } from '../domain/recurring';
import { supabase } from '../lib/supabase';
import { useRequiredHousehold } from './HouseholdProvider';
import { useCategories } from './useCategories';
import { useTransferLinks } from './useTransferLinks';

/** How far back to look: enough for a yearly charge to show up twice. */
const MONTHS_BACK = 26;
const PAGE = 1000; // the API returns at most this many rows per request

/**
 * The household's recurring charges, detected from money out over the last
 * MONTHS_BACK months. Transfers between the household's own accounts and
 * transfer categories (e.g. card payments) are left out; merchants marked
 * "not recurring" are returned separately as `hidden`.
 */
export function useRecurring() {
  const { household } = useRequiredHousehold();
  const { byId } = useCategories();
  const { byTxn } = useTransferLinks();
  const [rows, setRows] = useState<RecurringInput[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const since = new Date();
    since.setMonth(since.getMonth() - MONTHS_BACK);
    const all: RecurringInput[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, posted_on, amount_cents, display_description, category_id, account_id')
        .eq('status', 'posted')
        .lt('amount_cents', 0)
        .gte('posted_on', since.toISOString().slice(0, 10))
        .order('posted_on')
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) return setError(error.message);
      all.push(...data);
      if (data.length < PAGE) break;
    }
    const { data: hidden, error: hiddenError } = await supabase.from('recurring_dismissals').select('merchant_key');
    if (hiddenError) return setError(hiddenError.message);
    setRows(all);
    setDismissed(new Set(hidden.map((h) => h.merchant_key)));
    setError(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, household.id]);

  const { series, hidden } = useMemo(() => {
    if (!rows) return { series: null, hidden: [] };
    const spending = rows.filter((t) => {
      if (byTxn.has(t.id)) return false; // a transfer between the household's accounts
      const kind = t.category_id ? byId.get(t.category_id)?.kind : undefined;
      return kind !== 'transfer' && kind !== 'income';
    });
    // Data is complete up to each account's newest transaction (or today).
    const newest = new Map<string, string>();
    for (const t of rows) if (t.posted_on > (newest.get(t.account_id) ?? '')) newest.set(t.account_id, t.posted_on);
    const today = todayLocal();
    const found = detectRecurring(spending, (account) => newest.get(account) ?? today);
    return {
      series: found.filter((s) => !dismissed.has(s.key)),
      hidden: found.filter((s) => dismissed.has(s.key)),
    };
  }, [rows, byTxn, byId, dismissed]);

  const dismiss = useCallback(
    async (s: RecurringSeries, notRecurring: boolean) => {
      const { error } = notRecurring
        ? await supabase.from('recurring_dismissals').insert({ household_id: household.id, merchant_key: s.key })
        : await supabase.from('recurring_dismissals').delete().eq('merchant_key', s.key);
      if (error) return error.message;
      setDismissed((d) => {
        const next = new Set(d);
        if (notRecurring) next.add(s.key);
        else next.delete(s.key);
        return next;
      });
      return null;
    },
    [household.id],
  );

  return { series, hidden, error, refresh, dismiss };
}
