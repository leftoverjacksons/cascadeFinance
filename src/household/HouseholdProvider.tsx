import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';

export type Household = Database['public']['Tables']['households']['Row'];
export type Member = Database['public']['Tables']['household_members']['Row'];

interface HouseholdState {
  loading: boolean;
  error: string | null;
  /** null when the signed-in user does not belong to a household yet. */
  household: Household | null;
  members: Member[];
  me: Member | null;
  refresh: () => Promise<void>;
}

const HouseholdContext = createContext<HouseholdState | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    // RLS limits both queries to the caller's own household.
    const [h, m] = await Promise.all([
      supabase.from('households').select('*').maybeSingle(),
      supabase.from('household_members').select('*').order('created_at'),
    ]);
    if (h.error || m.error) {
      setError((h.error ?? m.error)!.message);
    } else {
      setHousehold(h.data);
      setMembers(m.data);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const me = members.find((m) => m.user_id === userId) ?? null;

  return (
    <HouseholdContext.Provider value={{ loading, error, household, members, me, refresh }}>
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold(): HouseholdState {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error('useHousehold must be used inside HouseholdProvider');
  return ctx;
}

/** Household that is known to exist (for use inside the main app shell). */
export function useRequiredHousehold(): HouseholdState & { household: Household; me: Member } {
  const state = useHousehold();
  if (!state.household || !state.me) throw new Error('No household loaded');
  return state as HouseholdState & { household: Household; me: Member };
}
