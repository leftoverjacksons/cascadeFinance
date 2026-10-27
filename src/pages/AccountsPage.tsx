import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
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
  IonToolbar,
  useIonActionSheet,
  useIonViewWillEnter,
} from '@ionic/react';
import { add } from 'ionicons/icons';
import { useState } from 'react';
import AccountFormModal from '../components/AccountFormModal';
import BalanceModal from '../components/BalanceModal';
import {
  ACCOUNT_GROUP_LABELS,
  ACCOUNT_TYPE_LABELS,
  groupAccounts,
  type Account,
} from '../domain/accounts';
import { formatDay } from '../domain/dates';
import { formatCents } from '../domain/money';
import { useRequiredHousehold } from '../household/HouseholdProvider';
import { useAccounts } from '../household/useAccounts';

export default function AccountsPage() {
  const { members } = useRequiredHousehold();
  const { accounts, balances, loading, error, refresh } = useAccounts();
  const [editing, setEditing] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const [balanceFor, setBalanceFor] = useState<Account | null>(null);
  const [actions] = useIonActionSheet();
  useIonViewWillEnter(() => void refresh());

  const ownerName = (id: string | null) =>
    id ? (members.find((m) => m.user_id === id)?.display_name ?? 'Unknown') : 'Joint';

  const visible = accounts.filter((a) => !a.is_archived);
  const archivedCount = accounts.length - visible.length;

  function openEditor(account: Account | null) {
    setEditing(account);
    setOpen(true);
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Accounts</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => openEditor(null)} aria-label="Add account">
              <IonIcon slot="icon-only" icon={add} />
            </IonButton>
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
        {!loading && visible.length === 0 && (
          <div className="ion-padding">
            <IonText color="medium">
              <p>No accounts yet. Add your checking, savings, cards and loans.</p>
            </IonText>
            <IonButton onClick={() => openEditor(null)}>Add account</IonButton>
          </div>
        )}
        {groupAccounts(visible).map(({ group, accounts: list }) => (
          <IonList key={group} inset>
            <IonListHeader>{ACCOUNT_GROUP_LABELS[group]}</IonListHeader>
            {list.map((a) => (
              <IonItem
                key={a.id}
                button
                detail
                onClick={() =>
                  void actions({
                    header: a.name,
                    buttons: [
                      { text: 'Record balance', handler: () => setBalanceFor(a) },
                      { text: 'Edit account', handler: () => openEditor(a) },
                      { text: 'Cancel', role: 'cancel' },
                    ],
                  })
                }
              >
                <IonLabel>
                  <h2>
                    {a.name}
                    {a.last4 && <span className="muted"> ··{a.last4}</span>}
                  </h2>
                  <p>
                    {[a.institution, ACCOUNT_TYPE_LABELS[a.type], ownerName(a.owner_user_id)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </IonLabel>
                {balances.has(a.id) && (
                  <IonNote slot="end" className="balance">
                    {a.is_liability && 'owes '}
                    {formatCents(balances.get(a.id)!.balance_cents)}
                    <br />
                    <small>as of {formatDay(balances.get(a.id)!.as_of)}</small>
                  </IonNote>
                )}
              </IonItem>
            ))}
          </IonList>
        ))}
        {archivedCount > 0 && (
          <IonList inset>
            <IonListHeader>Archived</IonListHeader>
            {accounts
              .filter((a) => a.is_archived)
              .map((a) => (
                <IonItem key={a.id} button detail onClick={() => openEditor(a)}>
                  <IonLabel color="medium">{a.name}</IonLabel>
                </IonItem>
              ))}
          </IonList>
        )}
      </IonContent>
      <BalanceModal
        account={balanceFor}
        onClose={(changed) => {
          setBalanceFor(null);
          if (changed) void refresh();
        }}
      />
      <AccountFormModal
        isOpen={open}
        account={editing}
        onClose={(changed) => {
          setOpen(false);
          if (changed) void refresh();
        }}
      />
    </IonPage>
  );
}
