import { useCallback, useEffect, useState } from 'react';
import type { Account } from '../domain/accounts';
import { supabase } from '../lib/supabase';

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('accounts').select('*').order('name');
    if (error) setError(error.message);
    else {
      setAccounts(data);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { accounts, loading, error, refresh };
}
