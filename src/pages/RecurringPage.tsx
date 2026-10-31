import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
  useIonViewWillEnter,
} from '@ionic/react';
import { Fragment, useState } from 'react';
import { categoryLabel } from '../domain/categories';
import { formatDay } from '../domain/dates';
import { formatCents, formatCentsWhole } from '../domain/money';
import { merchantKey } from '../domain/flows';
import { CADENCE_LABELS, type RecurringSeries } from '../domain/recurring';
import { useAccounts } from '../household/useAccounts';
import { useCategories } from '../household/useCategories';
import { useRecurring } from '../household/useRecurring';
import { useIsDesktop } from '../layout/useMediaQuery';

const SHOW_CHARGES = 12;

/** Recurring charges: subscriptions, bills and other money out on a regular cadence. */
export default function RecurringPage() {
  const { series, hidden, error, refresh, dismiss, setSameAs } = useRecurring();
  const { byId } = useCategories();
  const { accounts } = useAccounts();
  const [open, setOpen] = useState<string | null>(null);
  const [toast] = useIonToast();
  const isDesktop = useIsDesktop();

  useIonViewWillEnter(() => void refresh());

  const active = series?.filter((s) => !s.overdue) ?? [];
  const stopped = series?.filter((s) => s.overdue) ?? [];
  const monthly = active.reduce((t, s) => t + s.monthlyCents, 0);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '';

  async function setRecurring(s: RecurringSeries, notRecurring: boolean) {
    const message = await dismiss(s, notRecurring);
    if (message) void toast({ message, duration: 4000, color: 'danger' });
    else setOpen(null);
  }

  const amount = (s: RecurringSeries) => (
    <>
      {s.varies && 'about '}
      {formatCents(s.typicalCents)}
    </>
  );
  const nextText = (s: RecurringSeries) => (s.overdue ? `expected ${formatDay(s.next)}` : formatDay(s.next));

  /** Past charges and the "not recurring" control, shown under an opened series. */
  // Merchants a series can be said to be the "same as": every other one found.
  const merchants = [...new Map([...(series ?? []), ...hidden].map((x) => [x.merchantKey, x.label]))];
  async function sameAs(key: string, target: string | null) {
    const message = await setSameAs(key, target);
    if (message) void toast({ message, duration: 4000, color: 'danger' });
  }
  /** How a merged name appears on its charges. */
  const shownName = (s: RecurringSeries, alias: string) =>
    s.transactions.find((t) => merchantKey(t.display_description) === alias)?.display_description ?? alias;

  const details = (s: RecurringSeries, isHidden: boolean) => (
    <div className="recurring-details" data-testid="recurring-details">
      <p className="caption">
        {s.transactions.length} charges since {formatDay(s.first)} · {categoryLabel(s.categoryId, byId)} ·{' '}
        {accountName(s.accountId)}
      </p>
      <table className="data-table">
        <tbody>
          {s.transactions.slice(0, SHOW_CHARGES).map((t) => (
            <tr key={t.id}>
              <td>{formatDay(t.posted_on)}</td>
              {s.aliases.length > 0 && <td>{t.display_description}</td>}
              <td>{formatCents(-t.amount_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.aliases.length > 0 && (
        <p className="caption" data-testid="recurring-aliases">
          Also billed as{' '}
          {s.aliases.map((alias) => (
            <Fragment key={alias}>
              <strong>{shownName(s, alias)}</strong>{' '}
              <IonButton size="small" fill="clear" onClick={() => void sameAs(alias, null)}>
                Undo
              </IonButton>
            </Fragment>
          ))}
        </p>
      )}
      <IonButton size="small" fill="outline" color="medium" onClick={() => void setRecurring(s, !isHidden)}>
        {isHidden ? 'Show again' : 'Not recurring'}
      </IonButton>
      {merchants.length > 1 && (
        <IonSelect
          className="recurring-same-as"
          interface="popover"
          placeholder="Same as…"
          aria-label={`${s.label} is the same as`}
          value={null}
          onIonChange={(e) => e.detail.value && void sameAs(s.merchantKey, e.detail.value as string)}
        >
          {merchants
            .filter(([key]) => key !== s.merchantKey)
            .map(([key, label]) => (
              <IonSelectOption key={key} value={key}>
                {label}
              </IonSelectOption>
            ))}
        </IonSelect>
      )}
      {!isHidden && (series ?? []).filter((x) => x.merchantKey === s.merchantKey).length > 1 && (
        <IonNote className="hint"> Hides every series from this merchant.</IonNote>
      )}
    </div>
  );

  const section = (title: string, list: RecurringSeries[], isHidden = false) =>
    list.length > 0 &&
    (isDesktop ? (
      <section className="card">
        <h2>{title}</h2>
        <table className="data-table recurring-table" data-testid={`recurring-${title}`}>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>How often</th>
              <th>Amount</th>
              <th>Per month</th>
              <th>Last</th>
              <th>Next</th>
              <th>Account</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <Fragment key={s.key}>
                <tr className="clickable" data-recurring={s.key} onClick={() => setOpen(open === s.key ? null : s.key)}>
                  <td>{s.label}</td>
                  <td>{CADENCE_LABELS[s.cadence]}</td>
                  <td>{amount(s)}</td>
                  <td>{formatCentsWhole(s.monthlyCents)}</td>
                  <td>{formatDay(s.last)}</td>
                  <td className={s.overdue ? 'overdue' : ''}>{nextText(s)}</td>
                  <td>{accountName(s.accountId)}</td>
                  <td>{categoryLabel(s.categoryId, byId)}</td>
                </tr>
                {open === s.key && (
                  <tr className="child">
                    <td colSpan={8}>{details(s, isHidden)}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>
    ) : (
      <IonList inset data-testid={`recurring-${title}`}>
        <IonListHeader>{title}</IonListHeader>
        {list.map((s) => (
          <Fragment key={s.key}>
            <IonItem button detail={false} data-recurring={s.key} onClick={() => setOpen(open === s.key ? null : s.key)}>
              <IonLabel className="ion-text-wrap">
                <h3>{s.label}</h3>
                <p>
                  {CADENCE_LABELS[s.cadence]} · next {nextText(s)} · {accountName(s.accountId)}
                </p>
              </IonLabel>
              <IonNote slot="end" className="amount">
                {amount(s)}
              </IonNote>
            </IonItem>
            {open === s.key && <IonItem lines="full">{details(s, isHidden)}</IonItem>}
          </Fragment>
        ))}
      </IonList>
    ));

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          {!isDesktop && (
            <IonButtons slot="start">
              <IonBackButton defaultHref="/overview" />
            </IonButtons>
          )}
          <IonTitle>Recurring</IonTitle>
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
        <section className="card balance-card" data-testid="recurring-summary">
          {series === null ? (
            <p className="caption">Looking for recurring charges…</p>
          ) : (
            <>
              <p className="balance-line">About {formatCentsWhole(monthly)} a month</p>
              <p className="caption">
                in {active.length} recurring charge{active.length === 1 ? '' : 's'} (subscriptions, bills, loans).
                Found from charges to the same merchant at a steady pace; two subscriptions to one service (say,
                one each) show separately. Amounts that vary, like utilities, show their typical charge. Click one
                for its history, or mark it as not recurring.
              </p>
            </>
          )}
        </section>
        {series?.length === 0 && (
          <IonText color="medium">
            <p className="ion-padding">
              Nothing recurring found yet. A monthly charge needs three months of history to show up.
            </p>
          </IonText>
        )}
        {section('Active', active)}
        {section('May have stopped', stopped)}
        {section('Hidden', hidden, true)}
      </IonContent>
    </IonPage>
  );
}
