import {
  IonBadge,
  IonContent,
  IonHeader,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToolbar,
  useIonViewWillEnter,
} from '@ionic/react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import TransactionModal from '../components/TransactionModal';
import { formatDay } from '../domain/dates';
import { formatCents } from '../domain/money';
import { useAccounts } from '../household/useAccounts';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';

export type Transaction = Database['public']['Tables']['transactions']['Row'];

const PAGE = 100;
const ALL = 'all';

export default function TransactionsPage() {
  const { accounts, refresh: refreshAccounts } = useAccounts();
  const [accountId, setAccountId] = useState(ALL);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Transaction[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const requestId = useRef(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      let q = supabase
        .from('transactions')
        .select('*')
        // Pending first, then newest first; id breaks ties so paging is stable.
        .order('status', { ascending: false })
        .order('posted_on', { ascending: false })
        .order('id')
        .range(offset, offset + PAGE - 1);
      if (accountId !== ALL) q = q.eq('account_id', accountId);
      const term = search.trim().replace(/[%_,()]/g, ' ');
      if (term) q = q.or(`display_description.ilike.%${term}%,raw_description.ilike.%${term}%`);
      return q;
    },
    [accountId, search],
  );

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    const { data, error } = await fetchPage(0);
    if (id !== requestId.current) return; // a newer query superseded this one
    if (error) return setError(error.message);
    setError(null);
    setRows(data);
    setDone(data.length < PAGE);
  }, [fetchPage]);

  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [reload]);

  useIonViewWillEnter(() => {
    void refreshAccounts();
    void reload();
  });

  async function loadMore() {
    const { data, error } = await fetchPage(rows.length);
    if (error) return setError(error.message);
    setRows((prev) => [...prev, ...data]);
    setDone(data.length < PAGE);
  }

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const showAccount = accountId === ALL && accounts.length > 1;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Transactions</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar
            value={search}
            onIonInput={(e) => setSearch(e.detail.value ?? '')}
            placeholder="Search descriptions"
          />
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={(e) => void reload().then(() => e.detail.complete())}>
          <IonRefresherContent />
        </IonRefresher>
        <IonList inset>
          <IonItem>
            <IonSelect
              label="Account"
              value={accountId}
              onIonChange={(e) => setAccountId(e.detail.value as string)}
            >
              <IonSelectOption value={ALL}>All accounts</IonSelectOption>
              {accounts.map((a) => (
                <IonSelectOption key={a.id} value={a.id}>
                  {a.name}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
        </IonList>
        {error && (
          <IonText color="danger">
            <p className="ion-padding">{error}</p>
          </IonText>
        )}
        {rows.length === 0 && !error && (
          <IonText color="medium">
            <p className="ion-padding">No transactions yet. Import a CSV from the Import tab.</p>
          </IonText>
        )}
        <IonList inset data-testid="transactions">
          {rows.map((t, i) => {
            const header =
              t.status === 'pending'
                ? i === 0 && 'Pending'
                : (i === 0 || rows[i - 1].posted_on !== t.posted_on || rows[i - 1].status === 'pending') &&
                  formatDay(t.posted_on);
            return (
              <Fragment key={t.id}>
                {header && <IonItemDivider>{header}</IonItemDivider>}
                <IonItem button detail={false} onClick={() => setSelected(t)}>
                  <IonLabel>
                    <h3>{t.display_description}</h3>
                    <p>
                      {[showAccount && accountName(t.account_id), t.bank_category]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </IonLabel>
                  {t.status === 'pending' && (
                    <IonBadge slot="end" color="warning">
                      Pending
                    </IonBadge>
                  )}
                  <IonNote slot="end" className={t.amount_cents > 0 ? 'credit amount' : 'amount'}>
                    {formatCents(t.amount_cents)}
                  </IonNote>
                </IonItem>
              </Fragment>
            );
          })}
        </IonList>
        <IonInfiniteScroll
          disabled={done}
          onIonInfinite={(e) => void loadMore().then(() => e.target.complete())}
        >
          <IonInfiniteScrollContent />
        </IonInfiniteScroll>
      </IonContent>
      <TransactionModal
        transaction={selected}
        accountName={selected ? accountName(selected.account_id) : ''}
        onClose={(updated) => {
          setSelected(null);
          if (updated) setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        }}
      />
    </IonPage>
  );
}
