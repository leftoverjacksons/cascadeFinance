import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';

type TransferStatus = Database['public']['Enums']['transfer_status'];

export interface LinkedTxn {
  id: string;
  account_id: string;
  posted_on: string;
  amount_cents: number;
  display_description: string;
}

export interface TransferLink {
  id: string;
  status: TransferStatus;
  out: LinkedTxn;
  in: LinkedTxn;
}

/** How a given transaction is linked: which side it is and its counterpart. */
export interface LinkInfo {
  link: TransferLink;
  side: 'out' | 'in';
  peer: LinkedTxn;
}

const SELECT =
  'id, status, ' +
  'out:transactions!transfer_links_out_txn_id_fkey(id, account_id, posted_on, amount_cents, display_description), ' +
  'in:transactions!transfer_links_in_txn_id_fkey(id, account_id, posted_on, amount_cents, display_description)';

/** All of the household's transfer links (a few hundred at most). */
export function useTransferLinks() {
  const [links, setLinks] = useState<TransferLink[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from('transfer_links').select(SELECT).order('created_at', { ascending: false });
    if (error) setError(error.message);
    else {
      setLinks(data as unknown as TransferLink[]);
      setError(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byTxn = useMemo(() => {
    const map = new Map<string, LinkInfo>();
    for (const link of links) {
      map.set(link.out.id, { link, side: 'out', peer: link.in });
      map.set(link.in.id, { link, side: 'in', peer: link.out });
    }
    return map;
  }, [links]);

  return { links, byTxn, error, refresh };
}

/** e.g. "→ Joint" for money sent, "← Checking" for money received. */
export function transferLabel(info: LinkInfo, accountName: (id: string) => string): string {
  const arrow = info.side === 'out' ? '→' : '←';
  return `${arrow} ${accountName(info.peer.account_id)}${info.link.status === 'suggested' ? ' (check)' : ''}`;
}
