import { useCallback, useEffect, useState } from 'react';
import type { Account } from '../domain/accounts';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';

export type BalanceSnapshot = Database['public']['Tables']['balance_snapshots']['Row'];

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  /** Most recent balance snapshot per account id. */
  const [balances, setBalances] = useState<Map<string, BalanceSnapshot>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [acc, snap] = await Promise.all([
      supabase.from('accounts').select('*').order('name'),
      supabase
        .from('balance_snapshots')
        .select('*')
        .order('as_of', { ascending: false })
        .order('created_at', { ascending: false }),
    ]);
    if (acc.error || snap.error) setError((acc.error ?? snap.error)!.message);
    else {
      setAccounts(acc.data);
      const latest = new Map<string, BalanceSnapshot>();
      for (const s of snap.data) if (!latest.has(s.account_id)) latest.set(s.account_id, s);
      setBalances(latest);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { accounts, balances, loading, error, refresh };
}
