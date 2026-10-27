import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonModal,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { todayLocal } from '../domain/dates';
import { parseAmountToCents } from '../domain/money';
import { useRequiredHousehold } from '../household/HouseholdProvider';
import { supabase } from '../lib/supabase';

interface Props {
  isOpen: boolean;
  /** Pre-fill (e.g. "settle up" with the current balance). */
  preset?: { from: string; to: string; cents: number };
  onClose: (changed: boolean) => void;
}

/** Records a payment between members made outside the imported accounts (cash, Venmo…). */
export default function PaymentModal({ isOpen, preset, onClose }: Props) {
  const { household, members } = useRequiredHousehold();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();

  useEffect(() => {
    if (!isOpen) return;
    setFrom(preset?.from ?? members[0]?.user_id ?? '');
    setTo(preset?.to ?? members[1]?.user_id ?? '');
    setAmount(preset ? (preset.cents / 100).toFixed(2) : '');
    setDate(todayLocal());
    setNote('');
  }, [isOpen, preset, members]);

  const cents = parseAmountToCents(amount);
  const valid = cents !== null && cents > 0 && from && to && from !== to;

  async function save() {
    if (!valid) return;
    setBusy(true);
    const { error } = await supabase.from('manual_settlements').insert({
      household_id: household.id,
      from_user_id: from,
      to_user_id: to,
      amount_cents: cents!,
      settled_on: date,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 5000, color: 'danger' });
    else onClose(true);
  }

  return (
    <IonModal isOpen={isOpen} onDidDismiss={() => onClose(false)}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => onClose(false)}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>Record a payment</IonTitle>
          <IonButtons slot="end">
            <IonButton strong disabled={busy || !valid} onClick={() => void save()}>
              Save
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList inset>
          <IonItem>
            <IonSelect label="Paid by" value={from} onIonChange={(e) => setFrom(e.detail.value as string)}>
              {members.map((m) => (
                <IonSelectOption key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonSelect label="Paid to" value={to} onIonChange={(e) => setTo(e.detail.value as string)}>
              {members.map((m) => (
                <IonSelectOption key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonInput
              label="Amount"
              labelPlacement="stacked"
              inputmode="decimal"
              value={amount}
              onIonInput={(e) => setAmount(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="Date"
              labelPlacement="stacked"
              type="date"
              value={date}
              onIonInput={(e) => setDate(e.detail.value ?? todayLocal())}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="Note (optional)"
              labelPlacement="stacked"
              placeholder="e.g. Venmo, cash"
              maxlength={200}
              value={note}
              onIonInput={(e) => setNote(e.detail.value ?? '')}
            />
          </IonItem>
        </IonList>
      </IonContent>
    </IonModal>
  );
}
