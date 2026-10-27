import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
  useIonViewWillEnter,
} from '@ionic/react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import TransactionModal from '../components/TransactionModal';
import { categoryLabel } from '../domain/categories';
import { formatDay } from '../domain/dates';
import { formatCents } from '../domain/money';
import { useAccounts } from '../household/useAccounts';
import { useCategories } from '../household/useCategories';
import { useTransferLinks, type TransferLink } from '../household/useTransferLinks';
import { useIsDesktop } from '../layout/useMediaQuery';
import { supabase } from '../lib/supabase';
import type { Transaction } from './TransactionsPage';

const RECENT = 50;

export default function TransfersPage() {
  const { accounts, refresh: refreshAccounts } = useAccounts();
  const { tree, byId, categories, refresh: refreshCategories } = useCategories();
  const { links, byTxn, refresh: refreshLinks } = useTransferLinks();
  const [unmatched, setUnmatched] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();
  const isDesktop = useIsDesktop();

  const accountName = useCallback((id: string) => accounts.find((a) => a.id === id)?.name ?? '—', [accounts]);
  const transferCategoryIds = useMemo(
    () => categories.filter((c) => c.kind === 'transfer').map((c) => c.id),
    [categories],
  );

  // Transfer-categorised transactions with no linked counterpart.
  const loadUnmatched = useCallback(async () => {
    if (transferCategoryIds.length === 0) return setUnmatched([]);
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('status', 'posted')
      .in('category_id', transferCategoryIds)
      .neq('category_source', 'transfer')
      .order('posted_on', { ascending: false })
      .limit(200);
    setUnmatched(data ?? []);
  }, [transferCategoryIds]);

  useEffect(() => {
    void loadUnmatched();
  }, [loadUnmatched]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshAccounts(), refreshCategories(), refreshLinks(), loadUnmatched()]);
  }, [refreshAccounts, refreshCategories, refreshLinks, loadUnmatched]);

  useIonViewWillEnter(() => void refreshAll());

  async function run(op: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    const { error } = await op;
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 5000, color: 'danger' });
    await refreshAll();
  }

  async function findMatches() {
    setBusy(true);
    const { data, error } = await supabase.rpc('match_transfers');
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 5000, color: 'danger' });
    else
      void toast({ message: `Linked ${data} new transfer${data === 1 ? '' : 's'}.`, duration: 3000, color: 'success' });
    await refreshAll();
  }

  const suggested = links.filter((l) => l.status === 'suggested');
  // Grouped by category, largest group last so e.g. loan payments (which never
  // pair while loans are tracked by statement balance) don't bury the rest.
  const unmatchedGroups = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    for (const t of unmatched) {
      const key = t.category_id ?? '';
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    return [...groups.entries()].sort((a, b) => a[1].length - b[1].length);
  }, [unmatched]);
  const settled = links.filter((l) => l.status !== 'suggested').slice(0, RECENT);

  const linkRow = (l: TransferLink, actions: boolean) => (
    <IonItem key={l.id} data-link={l.id}>
      <IonLabel className="ion-text-wrap">
        <h3>
          {accountName(l.out.account_id)} → {accountName(l.in.account_id)}
          {l.status === 'auto' && <IonNote> · automatic</IonNote>}
        </h3>
        <p>
          Sent {formatDay(l.out.posted_on)} · received {formatDay(l.in.posted_on)}
        </p>
        <p>
          {l.out.display_description} / {l.in.display_description}
        </p>
      </IonLabel>
      <IonNote slot="end" className="amount">
        {formatCents(-l.out.amount_cents)}
      </IonNote>
      {actions && (
        <IonButtons slot="end">
          <IonButton
            size="small"
            disabled={busy}
            onClick={() => void run(supabase.rpc('confirm_transfer', { p_link: l.id }))}
          >
            Confirm
          </IonButton>
        </IonButtons>
      )}
      <IonButtons slot="end">
        <IonButton
          size="small"
          color="medium"
          disabled={busy}
          onClick={() => void run(supabase.rpc('unlink_transfer', { p_link: l.id }))}
        >
          Unlink
        </IonButton>
      </IonButtons>
    </IonItem>
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          {!isDesktop && (
            <IonButtons slot="start">
              <IonBackButton defaultHref="/transactions" />
            </IonButtons>
          )}
          <IonTitle>Transfers</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => void findMatches()} disabled={busy}>
              Find matches
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={(e) => void refreshAll().then(() => e.detail.complete())}>
          <IonRefresherContent />
        </IonRefresher>
        <div className={isDesktop ? 'import-layout' : undefined}>
          <div>
            <IonList inset>
              <IonItem lines="none">
                <IonText color="medium">
                  <p className="hint">
                    Money leaving one of your accounts and the same amount arriving in another within 4 days is linked
                    as one transfer, and left out of income and spending. Matching runs after every import.
                  </p>
                </IonText>
              </IonItem>
            </IonList>

            <IonList inset data-testid="transfers-to-check">
              <IonListHeader>
                To check
                {suggested.length > 0 && (
                  <IonBadge color="warning" className="kind-badge">
                    {suggested.length}
                  </IonBadge>
                )}
              </IonListHeader>
              {suggested.length === 0 && (
                <IonItem lines="none">
                  <IonNote>Nothing to check.</IonNote>
                </IonItem>
              )}
              {suggested.map((l) => linkRow(l, true))}
            </IonList>

            <IonList inset data-testid="transfers-unmatched">
              <IonListHeader>No match found ({unmatched.length})</IonListHeader>
              <IonItem lines="none">
                <IonText color="medium">
                  <p className="hint">
                    Categorised as transfers but with no other side yet: usually the other account isn't imported, or
                    the money left the household (e.g. Venmo to a friend). Open one to link it by hand or give it a
                    spending category.
                  </p>
                </IonText>
              </IonItem>
              {unmatchedGroups.map(([categoryId, txns]) => (
                <Fragment key={categoryId}>
                  <IonItemDivider>
                    {categoryLabel(categoryId, byId)} ({txns.length})
                  </IonItemDivider>
                  {txns.map((t) => (
                    <IonItem key={t.id} button detail onClick={() => setSelected(t)} data-txn={t.id}>
                      <IonLabel className="ion-text-wrap">
                        <h3 className="txn-name">{t.display_description}</h3>
                        <p>
                          {formatDay(t.posted_on)} · {accountName(t.account_id)} · {categoryLabel(t.category_id, byId)}
                        </p>
                      </IonLabel>
                      <IonNote slot="end" className={t.amount_cents > 0 ? 'credit amount' : 'amount'}>
                        {formatCents(t.amount_cents)}
                      </IonNote>
                    </IonItem>
                  ))}
                </Fragment>
              ))}
            </IonList>
          </div>
          <div>
            <IonList inset data-testid="transfers-linked">
              <IonListHeader>Linked transfers ({links.length - suggested.length})</IonListHeader>
              {settled.length === 0 && (
                <IonItem lines="none">
                  <IonNote>None yet. Import at least two of your accounts.</IonNote>
                </IonItem>
              )}
              {settled.map((l) => linkRow(l, false))}
              {links.length - suggested.length > RECENT && (
                <IonItem lines="none">
                  <IonNote>Showing the latest {RECENT}.</IonNote>
                </IonItem>
              )}
            </IonList>
          </div>
        </div>
      </IonContent>
      <TransactionModal
        transaction={selected}
        accountName={selected ? accountName(selected.account_id) : ''}
        tree={tree}
        byId={byId}
        account={selected ? accounts.find((a) => a.id === selected.account_id) : undefined}
        transferLinks={{ byTxn, accountName }}
        onClose={({ changed }) => {
          setSelected(null);
          if (changed) void refreshAll();
        }}
      />
    </IonPage>
  );
}
