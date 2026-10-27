import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
  useIonToast,
  useIonViewWillEnter,
} from '@ionic/react';
import { useCallback, useMemo, useState } from 'react';
import PaymentModal from '../components/PaymentModal';
import { formatDay } from '../domain/dates';
import { formatCents, formatCentsWhole } from '../domain/money';
import { monthlyBreakdown, whoOwes } from '../domain/shared';
import { splitShares } from '../domain/split';
import { useRequiredHousehold } from '../household/HouseholdProvider';
import { useAccounts } from '../household/useAccounts';
import { useShared } from '../household/useShared';
import { useIsDesktop } from '../layout/useMediaQuery';
import { supabase } from '../lib/supabase';

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function SharedPage() {
  const { household, members, refresh: refreshHousehold } = useRequiredHousehold();
  const { accounts } = useAccounts();
  const { ledger, transfers, manual, error, refresh } = useShared();
  const [payment, setPayment] = useState<{ open: boolean; preset?: { from: string; to: string; cents: number } }>({
    open: false,
  });
  const [toast] = useIonToast();
  const isDesktop = useIsDesktop();

  useIonViewWillEnter(() => void refresh());

  const [a, b] = members;
  const name = useCallback(
    (id: string) => members.find((m) => m.user_id === id)?.display_name ?? 'Someone',
    [members],
  );
  const accountName = (id: string | null) => accounts.find((x) => x.id === id)?.name ?? '';
  const shares = splitShares(members.map((m) => ({ ...m, split_weight: Number(m.split_weight) })));

  const debt = a && b && ledger ? whoOwes(ledger, a.user_id, b.user_id) : null;
  const months = useMemo(
    () => (a && b && ledger ? monthlyBreakdown(ledger, a.user_id, b.user_id) : []),
    [ledger, a, b],
  );
  // One row per shared expense (the ledger has one per other member).
  const expenses = useMemo(() => {
    const seen = new Set<string>();
    return (ledger ?? []).filter((e) => e.entry_kind === 'expense' && !seen.has(e.ref_id) && seen.add(e.ref_id));
  }, [ledger]);

  async function run(op: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await op;
    if (error) void toast({ message: error.message, duration: 5000, color: 'danger' });
    await refresh();
  }

  async function setSince(value: string | null) {
    await run(supabase.from('households').update({ shared_since: value }).eq('id', household.id));
    await refreshHousehold();
  }

  if (!b) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Shared</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonText color="medium">Add your partner in Settings to track shared expenses.</IonText>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          {!isDesktop && (
            <IonButtons slot="start">
              <IonBackButton defaultHref="/overview" />
            </IonButtons>
          )}
          <IonTitle>Shared</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setPayment({ open: true })}>Record a payment</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={(e) => void refresh().then(() => e.detail.complete())}>
          <IonRefresherContent />
        </IonRefresher>
        {error && (
          <IonText color="danger">
            <p className="ion-padding">{error}</p>
          </IonText>
        )}
        <div className={isDesktop ? 'import-layout' : undefined}>
          <div>
            <section className="card balance-card" data-testid="shared-balance">
              {ledger === null ? (
                <p className="caption">Loading…</p>
              ) : debt ? (
                <>
                  <p className="balance-line">
                    {name(debt.debtor)} owes {name(debt.creditor)}
                  </p>
                  <p className="balance-amount">{formatCents(debt.cents)}</p>
                </>
              ) : (
                <p className="balance-line">You're all square.</p>
              )}
              <p className="caption">
                {household.shared_since ? `Since ${formatDay(household.shared_since)}` : 'Across all imported history'} ·
                split {members.map((m) => `${m.display_name} ${Math.round((shares.get(m.user_id) ?? 0) * 100)}%`).join(' / ')}
              </p>
              {debt && (
                <IonButton
                  size="small"
                  onClick={() =>
                    setPayment({ open: true, preset: { from: debt.debtor, to: debt.creditor, cents: debt.cents } })
                  }
                >
                  Settle up
                </IonButton>
              )}
            </section>

            <IonList inset>
              <IonListHeader>How it works</IonListHeader>
              <IonItem lines="none">
                <IonText color="medium">
                  <p className="hint">
                    Shared expenses paid from one person's own account are split by your household split (Settings).
                    Spending from the joint account is already shared. Money sent from one of your accounts to the
                    other's, directly or through the joint account, counts as a payback unless you switch it off below.
                    Mark categories as shared in Settings → Categories, or individual transactions in their details.
                  </p>
                </IonText>
              </IonItem>
              <IonItem>
                <IonInput
                  label="Start counting from"
                  labelPlacement="stacked"
                  type="date"
                  value={household.shared_since ?? ''}
                  onIonChange={(e) => e.detail.value && void setSince(e.detail.value)}
                />
                {household.shared_since && (
                  <IonButton slot="end" fill="clear" size="small" onClick={() => void setSince(null)}>
                    All history
                  </IonButton>
                )}
              </IonItem>
            </IonList>

            <section className="card">
              <h2>By month</h2>
              <table className="data-table" data-testid="shared-months">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>{a.display_name} paid</th>
                    <th>{b.display_name} paid</th>
                    <th>Paid back</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => {
                    const back = [...m.paidBack.entries()]
                      .map(([who, cents]) => `${name(who)} ${formatCentsWhole(cents)}`)
                      .join(', ');
                    return (
                      <tr key={m.month}>
                        <td>{monthFmt.format(new Date(`${m.month}T00:00:00Z`))}</td>
                        <td>{formatCentsWhole(m.paidBy.get(a.user_id) ?? 0)}</td>
                        <td>{formatCentsWhole(m.paidBy.get(b.user_id) ?? 0)}</td>
                        <td>{back || '—'}</td>
                        <td>
                          {m.change === 0
                            ? '—'
                            : `${name(m.change > 0 ? b.user_id : a.user_id)} +${formatCentsWhole(Math.abs(m.change))}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {months.length === 0 && <p className="caption">Nothing shared yet.</p>}
              <p className="caption">
                "Change" is how much more the named person owes by the end of the month; shared spending from the joint
                account isn't listed because it creates no debt.
              </p>
            </section>
          </div>

          <div>
            <IonList inset data-testid="member-transfers">
              <IonListHeader>Money between you ({transfers.length})</IonListHeader>
              {transfers.length === 0 && (
                <IonItem lines="none">
                  <IonNote className="ion-text-wrap">
                    None found. Transfers appear here once both personal accounts are imported and linked (Transfers).
                  </IonNote>
                </IonItem>
              )}
              {transfers.map((t) => (
                <IonItem key={t.out_txn_id} data-transfer={t.out_txn_id}>
                  <IonLabel className="ion-text-wrap">
                    <h3>
                      {name(t.from_user)} → {name(t.to_user)} · {formatCents(t.amount_cents)}
                    </h3>
                    <p>
                      {formatDay(t.received_on)}
                      {t.via_account && ` · via ${accountName(t.via_account)}`}
                    </p>
                  </IonLabel>
                  <IonToggle
                    slot="end"
                    checked={t.is_settlement}
                    onIonChange={(e) =>
                      void run(
                        supabase.from('settlement_overrides').upsert({
                          out_txn_id: t.out_txn_id,
                          household_id: household.id,
                          is_settlement: e.detail.checked,
                        }),
                      )
                    }
                  >
                    Payback
                  </IonToggle>
                </IonItem>
              ))}
            </IonList>

            {manual.length > 0 && (
              <IonList inset data-testid="manual-payments">
                <IonListHeader>Recorded payments</IonListHeader>
                {manual.map((m) => (
                  <IonItem key={m.id}>
                    <IonLabel className="ion-text-wrap">
                      <h3>
                        {name(m.from_user_id)} → {name(m.to_user_id)} · {formatCents(m.amount_cents)}
                      </h3>
                      <p>
                        {formatDay(m.settled_on)}
                        {m.note && ` · ${m.note}`}
                      </p>
                    </IonLabel>
                    <IonButton
                      slot="end"
                      fill="clear"
                      color="medium"
                      onClick={() => void run(supabase.from('manual_settlements').delete().eq('id', m.id))}
                    >
                      Delete
                    </IonButton>
                  </IonItem>
                ))}
              </IonList>
            )}

            <IonList inset data-testid="shared-expenses">
              <IonListHeader>Shared expenses ({expenses.length})</IonListHeader>
              {expenses.slice(0, 100).map((e) => (
                <IonItem key={e.ref_id}>
                  <IonLabel className="ion-text-wrap">
                    <h3>{e.description}</h3>
                    <p>
                      {formatDay(e.entry_date)} · paid by {name(e.creditor)} ·{' '}
                      {name(e.debtor)}'s share {formatCents(e.cents)}
                    </p>
                  </IonLabel>
                  <IonNote slot="end" className="amount">
                    {formatCents(e.total_cents)}
                  </IonNote>
                  <IonButton
                    slot="end"
                    fill="clear"
                    color="medium"
                    size="small"
                    onClick={() =>
                      void run(supabase.from('transactions').update({ shared_override: false }).eq('id', e.ref_id))
                    }
                  >
                    Not shared
                  </IonButton>
                </IonItem>
              ))}
              {expenses.length > 100 && (
                <IonItem lines="none">
                  <IonNote>Showing the latest 100.</IonNote>
                </IonItem>
              )}
            </IonList>
          </div>
        </div>
      </IonContent>
      <PaymentModal
        isOpen={payment.open}
        preset={payment.preset}
        onClose={(changed) => {
          setPayment({ open: false });
          if (changed) void refresh();
        }}
      />
    </IonPage>
  );
}
