import { IonSearchbar, IonSegment, IonSegmentButton, IonLabel } from '@ionic/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import TransactionModal from '../components/TransactionModal';
import { categoryLabel } from '../domain/categories';
import { formatDay } from '../domain/dates';
import { formatCents } from '../domain/money';
import { useAccounts } from '../household/useAccounts';
import { useCategories } from '../household/useCategories';
import { useTransferLinks } from '../household/useTransferLinks';
import { supabase } from '../lib/supabase';
import type { Transaction } from '../pages/TransactionsPage';
import type { PanelProps } from './panels';

const LIMIT = 200;

/**
 * Compact transaction list for the desktop dashboard. While a flow is selected
 * on the money-flow diagram, it lists that flow's transactions instead.
 */
export default function TransactionsPanel({ onDataChanged, flow, onFlow }: PanelProps) {
  const { tree, byId } = useCategories();
  const { accounts } = useAccounts();
  const { byTxn, refresh: refreshLinks } = useTransferLinks();
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (flow) {
      const { data } = await supabase
        .rpc('money_flow_transactions', {
          p_from: flow.from,
          p_to: flow.to,
          p_kinds: flow.rows.map((r) => r.kind),
          p_sources: flow.rows.map((r) => r.source),
          p_targets: flow.rows.map((r) => r.target),
        })
        .limit(LIMIT);
      if (id === requestId.current) setRows(data ?? []);
      return;
    }
    let q = supabase
      .from('transactions')
      .select('*')
      .order('status', { ascending: false })
      .order('posted_on', { ascending: false })
      .order('id')
      .limit(LIMIT);
    if (onlyUncategorized) q = q.is('category_id', null);
    const term = search.trim().replace(/[%_,()]/g, ' ');
    if (term) q = q.or(`display_description.ilike.%${term}%,raw_description.ilike.%${term}%`);
    const { data } = await q;
    if (id === requestId.current) setRows(data ?? []);
  }, [onlyUncategorized, search, flow]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';

  return (
    <div className="panel-transactions" data-testid="transactions-panel">
      {flow ? (
        <div className="flows-selection" data-testid="transactions-flow-filter">
          <span>
            {rows.length === LIMIT ? `Latest ${LIMIT}` : rows.length} transaction{rows.length === 1 ? '' : 's'} in{' '}
            <strong>{flow.label}</strong>
          </span>
          <button className="link-like" onClick={() => onFlow(null)}>
            Show all
          </button>
        </div>
      ) : (
        <div className="panel-toolbar">
          <IonSegment
            value={onlyUncategorized ? 'none' : 'all'}
            onIonChange={(e) => setOnlyUncategorized(e.detail.value === 'none')}
          >
            <IonSegmentButton value="all">
              <IonLabel>All</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="none">
              <IonLabel>Uncategorized</IonLabel>
            </IonSegmentButton>
          </IonSegment>
          <IonSearchbar value={search} onIonInput={(e) => setSearch(e.detail.value ?? '')} placeholder="Search" />
        </div>
      )}
      <div className="panel-scroll">
        <table className="data-table txn-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="clickable" onClick={() => setSelected(t)}>
                <td>{t.status === 'pending' ? 'Pending' : formatDay(t.posted_on).replace(/^\w+, /, '')}</td>
                <td>{t.display_description}</td>
                <td className={t.category_id ? '' : 'uncategorized'}>{categoryLabel(t.category_id, byId)}</td>
                <td className={t.amount_cents > 0 ? 'credit' : ''}>{formatCents(t.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="caption">Nothing to show.</p>}
        {rows.length === LIMIT && !flow && (
          <p className="caption">Showing the latest {LIMIT}; use Transactions for everything.</p>
        )}
      </div>
      <TransactionModal
        transaction={selected}
        accountName={selected ? accountName(selected.account_id) : ''}
        tree={tree}
        byId={byId}
        account={selected ? accounts.find((a) => a.id === selected.account_id) : undefined}
        transferLinks={{ byTxn, accountName }}
        onClose={({ changed, rulesChanged }) => {
          setSelected(null);
          if (changed || rulesChanged) {
            void load();
            void refreshLinks();
            onDataChanged();
          }
        }}
      />
    </div>
  );
}
