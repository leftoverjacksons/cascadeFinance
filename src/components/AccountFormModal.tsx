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
  IonToggle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useEffect, useState, type FormEvent } from 'react';
import { ACCOUNT_TYPE_LABELS, type Account, type AccountType } from '../domain/accounts';
import { useRequiredHousehold } from '../household/HouseholdProvider';
import { supabase } from '../lib/supabase';

const JOINT = 'joint';

interface Props {
  isOpen: boolean;
  /** Account to edit; null to create a new one. */
  account: Account | null;
  onClose: (changed: boolean) => void;
}

export default function AccountFormModal({ isOpen, account, onClose }: Props) {
  const { household, members } = useRequiredHousehold();
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [owner, setOwner] = useState<string>(JOINT);
  const [last4, setLast4] = useState('');
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();

  useEffect(() => {
    if (!isOpen) return;
    setName(account?.name ?? '');
    setInstitution(account?.institution ?? '');
    setType(account?.type ?? 'checking');
    setOwner(account?.owner_user_id ?? JOINT);
    setLast4(account?.last4 ?? '');
    setArchived(account?.is_archived ?? false);
  }, [isOpen, account]);

  const last4Valid = last4 === '' || /^\d{4}$/.test(last4);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const fields = {
      name: name.trim(),
      institution: institution.trim() || null,
      type,
      owner_user_id: owner === JOINT ? null : owner,
      last4: last4 || null,
      is_archived: archived,
    };
    const { error } = account
      ? await supabase.from('accounts').update(fields).eq('id', account.id)
      : await supabase.from('accounts').insert({ ...fields, household_id: household.id });
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 4000, color: 'danger' });
    else onClose(true);
  }

  return (
    <IonModal isOpen={isOpen} onDidDismiss={() => onClose(false)}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => onClose(false)}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>{account ? 'Edit account' : 'New account'}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <form onSubmit={save}>
          <IonList inset>
            <IonItem>
              <IonInput
                label="Name"
                labelPlacement="stacked"
                placeholder="e.g. Alex Checking"
                value={name}
                maxlength={100}
                onIonInput={(e) => setName(e.detail.value ?? '')}
                required
              />
            </IonItem>
            <IonItem>
              <IonInput
                label="Institution"
                labelPlacement="stacked"
                placeholder="e.g. USAA"
                value={institution}
                maxlength={100}
                onIonInput={(e) => setInstitution(e.detail.value ?? '')}
              />
            </IonItem>
            <IonItem>
              <IonSelect
                label="Type"
                labelPlacement="stacked"
                value={type}
                onIonChange={(e) => setType(e.detail.value as AccountType)}
              >
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <IonSelectOption key={value} value={value}>
                    {label}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonItem>
              <IonSelect
                label="Owner"
                labelPlacement="stacked"
                value={owner}
                onIonChange={(e) => setOwner(e.detail.value as string)}
              >
                <IonSelectOption value={JOINT}>Joint</IonSelectOption>
                {members.map((m) => (
                  <IonSelectOption key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonItem>
              <IonInput
                label="Last 4 digits (optional)"
                labelPlacement="stacked"
                inputmode="numeric"
                maxlength={4}
                value={last4}
                onIonInput={(e) => setLast4(e.detail.value ?? '')}
                errorText="Four digits"
                className={last4Valid ? '' : 'ion-invalid ion-touched'}
              />
            </IonItem>
            {account && (
              <IonItem>
                <IonToggle checked={archived} onIonChange={(e) => setArchived(e.detail.checked)}>
                  Archived (hidden, history kept)
                </IonToggle>
              </IonItem>
            )}
          </IonList>
          <IonButton expand="block" type="submit" disabled={busy || !name.trim() || !last4Valid}>
            Save
          </IonButton>
        </form>
      </IonContent>
    </IonModal>
  );
}
