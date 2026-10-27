import {
  IonBadge,
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonFooter,
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
  useIonToast,
  useIonViewWillEnter,
} from '@ionic/react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import CategoryPicker from '../components/CategoryPicker';
import TransactionModal from '../components/TransactionModal';
import { categoryLabel } from '../domain/categories';
import { formatDay } from '../domain/dates';
import { formatCents } from '../domain/money';
import { useAccounts } from '../household/useAccounts';
import { useCategories } from '../household/useCategories';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';

export type Transaction = Database['public']['Tables']['transactions']['Row'];

const PAGE = 100;
const ALL = 'all';
const UNCATEGORIZED = 'none';

export default function TransactionsPage() {
  const { accounts, refresh: refreshAccounts } = useAccounts();
  const { tree, byId, refresh: refreshCategories } = useCategories();
  const [accountId, setAccountId] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Transaction[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [toast] = useIonToast();
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
      if (categoryFilter === UNCATEGORIZED) q = q.is('category_id', null);
      else if (categoryFilter !== ALL) {
        // A group filter includes its categories.
        const ids = [categoryFilter, ...[...byId.values()].filter((c) => c.parent_id === categoryFilter).map((c) => c.id)];
        q = q.in('category_id', ids);
      }
      const term = search.trim().replace(/[%_,()]/g, ' ');
      if (term) q = q.or(`display_description.ilike.%${term}%,raw_description.ilike.%${term}%`);
      return q;
    },
    [accountId, categoryFilter, search, byId],
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
    void refreshCategories();
    void reload();
  });

  async function loadMore() {
    const { data, error } = await fetchPage(rows.length);
    if (error) return setError(error.message);
    setRows((prev) => [...prev, ...data]);
    setDone(data.length < PAGE);
  }

  function toggleSelecting() {
    setSelecting(!selecting);
    setChecked(new Set());
  }

  async function bulkCategorise(categoryId: string | null) {
    setBulkPickerOpen(false);
    const ids = [...checked];
    const { data, error } = await supabase.rpc('set_transaction_category', {
      p_ids: ids,
      p_category_id: categoryId as string,
    });
    if (error) {
      void toast({ message: error.message, duration: 5000, color: 'danger' });
      return;
    }
    const skipped = ids.length - (data ?? 0);
    void toast({
      message: `Updated ${data} transaction${data === 1 ? '' : 's'}${skipped ? `; ${skipped} pending skipped` : ''}.`,
      duration: 3000,
      color: 'success',
    });
    setSelecting(false);
    setChecked(new Set());
    await reload();
  }

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';
  const showAccount = accountId === ALL && accounts.length > 1;
  const filterLabel =
    categoryFilter === ALL
      ? 'All categories'
      : categoryFilter === UNCATEGORIZED
        ? 'Uncategorized'
        : categoryLabel(categoryFilter, byId);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Transactions</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={toggleSelecting}>{selecting ? 'Done' : 'Select'}</IonButton>
          </IonButtons>
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
          <IonItem button detail onClick={() => setFilterPickerOpen(true)} data-testid="category-filter">
            <IonLabel>Category</IonLabel>
            <IonNote slot="end">{filterLabel}</IonNote>
          </IonItem>
          {categoryFilter !== ALL && (
            <IonItem button detail={false} onClick={() => setCategoryFilter(ALL)}>
              <IonLabel color="primary">Clear category filter</IonLabel>
            </IonItem>
          )}
        </IonList>
        {error && (
          <IonText color="danger">
            <p className="ion-padding">{error}</p>
          </IonText>
        )}
        {rows.length === 0 && !error && (
          <IonText color="medium">
            <p className="ion-padding">No transactions match.</p>
          </IonText>
        )}
        <IonList inset data-testid="transactions">
          {rows.map((t, i) => {
            const header =
              t.status === 'pending'
                ? i === 0 && 'Pending'
                : (i === 0 || rows[i - 1].posted_on !== t.posted_on || rows[i - 1].status === 'pending') &&
                  formatDay(t.posted_on);
            const isChecked = checked.has(t.id);
            return (
              <Fragment key={t.id}>
                {header && <IonItemDivider>{header}</IonItemDivider>}
                <IonItem
                  button
                  detail={false}
                  onClick={() => {
                    if (!selecting) return setSelected(t);
                    const next = new Set(checked);
                    if (isChecked) next.delete(t.id);
                    else next.add(t.id);
                    setChecked(next);
                  }}
                >
                  {selecting && <IonCheckbox slot="start" checked={isChecked} aria-label="Select" />}
                  <IonLabel>
                    <h3>{t.display_description}</h3>
                    <p className={t.category_id ? '' : 'uncategorized'}>
                      {[showAccount && accountName(t.account_id), categoryLabel(t.category_id, byId)]
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
      {selecting && (
        <IonFooter>
          <IonToolbar>
            <IonButtons slot="end">
              <IonButton
                strong
                disabled={checked.size === 0}
                onClick={() => setBulkPickerOpen(true)}
              >
                Categorize {checked.size}
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonFooter>
      )}
      <TransactionModal
        transaction={selected}
        accountName={selected ? accountName(selected.account_id) : ''}
        tree={tree}
        byId={byId}
        onClose={({ changed, rulesChanged }) => {
          setSelected(null);
          if (changed || rulesChanged) void reload();
        }}
      />
      <CategoryPicker
        isOpen={filterPickerOpen}
        tree={tree}
        title="Filter by category"
        allowNone
        onCancel={() => setFilterPickerOpen(false)}
        onSelect={(id) => {
          setFilterPickerOpen(false);
          setCategoryFilter(id ?? UNCATEGORIZED);
        }}
      />
      <CategoryPicker
        isOpen={bulkPickerOpen}
        tree={tree}
        title={`Categorize ${checked.size}`}
        allowNone
        noneLabel="Automatic (use rules)"
        onCancel={() => setBulkPickerOpen(false)}
        onSelect={(id) => void bulkCategorise(id)}
      />
    </IonPage>
  );
}
