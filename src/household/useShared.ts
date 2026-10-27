import { useCallback, useEffect, useState } from 'react';
import type { LedgerEntry } from '../domain/shared';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';

export type MemberTransfer = Database['public']['Functions']['member_transfers']['Returns'][number];
export type ManualSettlement = Database['public']['Tables']['manual_settlements']['Row'];

/** The household's shared ledger, member-to-member transfers and recorded payments. */
export function useShared() {
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [transfers, setTransfers] = useState<MemberTransfer[]>([]);
  const [manual, setManual] = useState<ManualSettlement[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [l, t, m] = await Promise.all([
      supabase.rpc('shared_ledger'),
      supabase.rpc('member_transfers'),
      supabase.from('manual_settlements').select('*').order('settled_on', { ascending: false }),
    ]);
    const err = l.error ?? t.error ?? m.error;
    if (err) return setError(err.message);
    setError(null);
    setLedger(l.data as LedgerEntry[]);
    setTransfers([...(t.data ?? [])].sort((x, y) => y.received_on.localeCompare(x.received_on)));
    setManual(m.data ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ledger, transfers, manual, error, refresh };
}
