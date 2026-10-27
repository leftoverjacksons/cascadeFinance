import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonModal,
  IonNote,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import type { Account } from '../domain/accounts';
import { todayLocal } from '../domain/dates';
import { parseAmountToCents } from '../domain/money';
import { supabase } from '../lib/supabase';

interface Props {
  account: Account | null;
  onClose: (changed: boolean) => void;
}

/** Records a balance from a statement (or the bank's website) for an account. */
export default function BalanceModal({ account, onClose }: Props) {
  const [date, setDate] = useState(todayLocal());
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();

  useEffect(() => {
    setDate(todayLocal());
    setAmount('');
  }, [account]);

  const cents = amount.trim() ? parseAmountToCents(amount) : null;
  const valid = cents !== null && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function save() {
    if (!account || cents === null) return;
    setBusy(true);
    const { error } = await supabase.from('balance_snapshots').insert({
      household_id: account.household_id,
      account_id: account.id,
      as_of: date,
      balance_cents: cents,
      source: 'statement',
    });
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 5000, color: 'danger' });
    else onClose(true);
  }

  return (
    <IonModal isOpen={account !== null} onDidDismiss={() => onClose(false)}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => onClose(false)}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>Record balance</IonTitle>
          <IonButtons slot="end">
            <IonButton strong disabled={busy || !valid} onClick={() => void save()}>
              Save
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      {account && (
        <IonContent>
          <IonList inset>
            <IonItem>
              <IonInput
                label="As of"
                labelPlacement="stacked"
                type="date"
                value={date}
                onIonInput={(e) => setDate(e.detail.value ?? todayLocal())}
              />
            </IonItem>
            <IonItem>
              <IonInput
                label={account.is_liability ? 'Amount owed' : 'Balance'}
                labelPlacement="stacked"
                inputmode="decimal"
                placeholder={account.is_liability ? 'e.g. 18,240.55' : 'e.g. 2,431.17'}
                value={amount}
                onIonInput={(e) => setAmount(e.detail.value ?? '')}
              />
            </IonItem>
          </IonList>
          <IonNote className="ion-padding" style={{ display: 'block' }}>
            {account.is_liability
              ? 'Enter what you owe as a positive number, as shown on the statement.'
              : "Use the current (posted) balance, not the available balance, so it lines up with posted transactions."}
          </IonNote>
        </IonContent>
      )}
    </IonModal>
  );
}
