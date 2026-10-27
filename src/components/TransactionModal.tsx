import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonTextarea,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { formatDay } from '../domain/dates';
import { formatCents } from '../domain/money';
import { supabase } from '../lib/supabase';
import type { Transaction } from '../pages/TransactionsPage';

interface Props {
  transaction: Transaction | null;
  accountName: string;
  onClose: (updated: Transaction | null) => void;
}

export default function TransactionModal({ transaction: t, accountName, onClose }: Props) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();

  useEffect(() => {
    setName(t?.display_description ?? '');
    setNotes(t?.notes ?? '');
  }, [t]);

  async function save() {
    if (!t) return;
    setBusy(true);
    const { data, error } = await supabase
      .from('transactions')
      .update({ display_description: name.trim() || t.raw_description, notes: notes.trim() || null })
      .eq('id', t.id)
      .select()
      .single();
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 4000, color: 'danger' });
    else onClose(data);
  }

  return (
    <IonModal isOpen={t !== null} onDidDismiss={() => onClose(null)}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => onClose(null)}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>Transaction</IonTitle>
          <IonButtons slot="end">
            <IonButton strong onClick={() => void save()} disabled={busy || t?.status === 'pending'}>
              Save
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      {t && (
        <IonContent>
          <IonList inset>
            <IonItem>
              <IonLabel>Amount</IonLabel>
              <IonNote slot="end" className={t.amount_cents > 0 ? 'credit' : ''}>
                {formatCents(t.amount_cents)}
              </IonNote>
            </IonItem>
            <IonItem>
              <IonLabel>Date</IonLabel>
              <IonNote slot="end">
                {formatDay(t.posted_on)}
                {t.status === 'pending' && ' (pending)'}
              </IonNote>
            </IonItem>
            <IonItem>
              <IonLabel>Account</IonLabel>
              <IonNote slot="end">{accountName}</IonNote>
            </IonItem>
            <IonItem>
              <IonLabel>Bank category</IonLabel>
              <IonNote slot="end">{t.bank_category ?? '—'}</IonNote>
            </IonItem>
            <IonItem>
              <IonLabel className="ion-text-wrap">
                <p>Bank description</p>
                <h3 className="mono">{t.raw_description}</h3>
              </IonLabel>
            </IonItem>
          </IonList>
          <IonList inset>
            <IonItem>
              <IonInput
                label="Name"
                labelPlacement="stacked"
                value={name}
                disabled={t.status === 'pending'}
                onIonInput={(e) => setName(e.detail.value ?? '')}
              />
            </IonItem>
            <IonItem>
              <IonTextarea
                label="Notes"
                labelPlacement="stacked"
                autoGrow
                maxlength={1000}
                value={notes}
                disabled={t.status === 'pending'}
                onIonInput={(e) => setNotes(e.detail.value ?? '')}
              />
            </IonItem>
          </IonList>
          {t.status === 'pending' && (
            <IonNote className="ion-padding" style={{ display: 'block' }}>
              Pending transactions are replaced by the next import, so they can't be edited until they post.
            </IonNote>
          )}
        </IonContent>
      )}
    </IonModal>
  );
}
