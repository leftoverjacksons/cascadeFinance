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
import { useIsDesktop } from '../layout/useMediaQuery';
import { transferLabel, useTransferLinks } from '../household/useTransferLinks';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';

export type Transaction = Database['public']['Tables']['transactions']['Row'];

const PAGE = 100;
const ALL = 'all';
const UNCATEGORIZED = 'none';

export default function TransactionsPage() {
  const { accounts, refresh: refreshAccounts } = useAccounts();
  const { tree, byId, refresh: refreshCategories } = useCategories();
  const { byTxn: linkByTxn, refresh: refreshLinks } = useTransferLinks();
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
  const isDesktop = useIsDesktop();
  // Desktop table sorting. Pending rows stay on top only for newest-first.
  const [sort, setSort] = useState<{ key: 'date' | 'amount'; asc: boolean }>({ key: 'date', asc: false });

  const fetchPage = useCallback(
    async (offset: number) => {
      let q = supabase.from('transactions').select('*');
      if (sort.key === 'date') {
        // Pending first (newest-first only), then by date; id keeps paging stable.
        if (!sort.asc) q = q.order('status', { ascending: false });
        q = q.order('posted_on', { ascending: sort.asc });
      } else {
        q = q.order('amount_cents', { ascending: sort.asc });
      }
      q = q.order('id').range(offset, offset + PAGE - 1);
      if (accountId !== ALL) q = q.eq('account_id', accountId);
      if (categoryFilter === UNCATEGORIZED) q = q.is('category_id', null);
      else if (categoryFilter !== ALL) {
        // A group filter includes its categories.
        const ids = [
          categoryFilter,
          ...[...byId.values()].filter((c) => c.parent_id === categoryFilter).map((c) => c.id),
        ];
        q = q.in('category_id', ids);
      }
      const term = search.trim().replace(/[%_,()]/g, ' ');
      if (term) q = q.or(`display_description.ilike.%${term}%,raw_description.ilike.%${term}%`);
      return q;
    },
    [accountId, categoryFilter, search, byId, sort],
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
    void refreshLinks();
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

  function onRowClick(t: Transaction) {
    if (!selecting) return setSelected(t);
    const next = new Set(checked);
    if (next.has(t.id)) next.delete(t.id);
    else next.add(t.id);
    setChecked(next);
  }

  function closeDetail({ changed, rulesChanged }: { changed: boolean; rulesChanged: boolean }) {
    setSelected(null);
    if (changed || rulesChanged) {
      void reload();
      void refreshLinks();
    }
  }

  function sortBy(key: 'date' | 'amount') {
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === 'amount' }));
  }
  const sortMark = (key: 'date' | 'amount') => (sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : '');
  const ariaSort = (key: 'date' | 'amount') => (sort.key === key ? (sort.asc ? 'ascending' : 'descending') : undefined);
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
            <IonButton routerLink="/transfers">Transfers</IonButton>
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
        <div className={isDesktop ? 'txn-layout' : undefined}>
          <div className="txn-main">
            <IonList inset className={isDesktop ? 'txn-filters' : undefined}>
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
            {isDesktop ? (
              <table className="data-table txn-table txn-table-full" data-testid="transactions">
                <thead>
                  <tr>
                    {selecting && <th aria-label="Selected" />}
                    <th aria-sort={ariaSort('date')}>
                      <button className="sort" onClick={() => sortBy('date')}>
                        Date{sortMark('date')}
                      </button>
                    </th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Account</th>
                    <th aria-sort={ariaSort('amount')}>
                      <button className="sort" onClick={() => sortBy('amount')}>
                        Amount{sortMark('amount')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr
                      key={t.id}
                      data-txn={t.id}
                      className={`clickable${selected?.id === t.id ? ' selected' : ''}`}
                      onClick={() => onRowClick(t)}
                    >
                      {selecting && (
                        <td>
                          <IonCheckbox checked={checked.has(t.id)} aria-label="Select" />
                        </td>
                      )}
                      <td>
                        {t.status === 'pending' ? <IonBadge color="warning">Pending</IonBadge> : formatDay(t.posted_on)}
                      </td>
                      <td className="txn-name">{t.display_description}</td>
                      <td className={t.category_id ? '' : 'uncategorized'}>
                        {categoryLabel(t.category_id, byId)}
                        {linkByTxn.has(t.id) && (
                          <span className="transfer-tag">{transferLabel(linkByTxn.get(t.id)!, accountName)}</span>
                        )}
                      </td>
                      <td>{accountName(t.account_id)}</td>
                      <td className={t.amount_cents > 0 ? 'credit amount' : 'amount'}>{formatCents(t.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
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
                      <IonItem button detail={false} onClick={() => onRowClick(t)} data-txn={t.id}>
                        {selecting && <IonCheckbox slot="start" checked={isChecked} aria-label="Select" />}
                        <IonLabel>
                          <h3 className="txn-name">{t.display_description}</h3>
                          <p className={t.category_id ? '' : 'uncategorized'}>
                            {[
                              showAccount && accountName(t.account_id),
                              categoryLabel(t.category_id, byId),
                              linkByTxn.has(t.id) && transferLabel(linkByTxn.get(t.id)!, accountName),
                            ]
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
            )}
            <IonInfiniteScroll disabled={done} onIonInfinite={(e) => void loadMore().then(() => e.target.complete())}>
              <IonInfiniteScrollContent />
            </IonInfiniteScroll>
          </div>
          {isDesktop &&
            (selected ? (
              <TransactionModal
                presentation="panel"
                transaction={selected}
                accountName={accountName(selected.account_id)}
                tree={tree}
                byId={byId}
                transferLinks={{ byTxn: linkByTxn, accountName }}
                onClose={closeDetail}
              />
            ) : (
              <aside className="side-panel side-panel-empty" aria-label="Transaction details">
                <p className="caption">Select a transaction to see and edit its details.</p>
              </aside>
            ))}
        </div>
      </IonContent>
      {selecting && (
        <IonFooter>
          <IonToolbar>
            <IonButtons slot="end">
              <IonButton strong disabled={checked.size === 0} onClick={() => setBulkPickerOpen(true)}>
                Categorize {checked.size}
              </IonButton>
            </IonButtons>
          </IonToolbar>
        </IonFooter>
      )}
      {!isDesktop && (
        <TransactionModal
          transaction={selected}
          accountName={selected ? accountName(selected.account_id) : ''}
          tree={tree}
          byId={byId}
          transferLinks={{ byTxn: linkByTxn, accountName }}
          onClose={closeDetail}
        />
      )}
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
