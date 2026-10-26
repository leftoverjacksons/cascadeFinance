import {
  IonButton,
  IonContent,
  IonInput,
  IonItem,
  IonList,
  IonPage,
  IonText,
  useIonToast,
} from '@ionic/react';
import { useState, type FormEvent } from 'react';
import { useHousehold } from '../household/HouseholdProvider';
import { supabase } from '../lib/supabase';

export default function SetupHouseholdPage() {
  const { refresh } = useHousehold();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('create_household', {
      p_name: name.trim(),
      p_display_name: displayName.trim(),
    });
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 4000, color: 'danger' });
    else await refresh();
  }

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <div className="narrow">
          <h1>Set up your household</h1>
          <IonText color="medium">
            <p>
              You are not in a household yet. If your partner already created one, ask them to add
              you from Settings, then sign in again. Otherwise create it here.
            </p>
          </IonText>
          <form onSubmit={create}>
            <IonList inset>
              <IonItem>
                <IonInput
                  label="Household name"
                  labelPlacement="stacked"
                  value={name}
                  maxlength={100}
                  onIonInput={(e) => setName(e.detail.value ?? '')}
                  required
                />
              </IonItem>
              <IonItem>
                <IonInput
                  label="Your name"
                  labelPlacement="stacked"
                  value={displayName}
                  maxlength={50}
                  onIonInput={(e) => setDisplayName(e.detail.value ?? '')}
                  required
                />
              </IonItem>
            </IonList>
            <IonButton
              expand="block"
              type="submit"
              disabled={busy || !name.trim() || !displayName.trim()}
            >
              Create household
            </IonButton>
            <IonButton expand="block" fill="clear" onClick={() => void supabase.auth.signOut()}>
              Sign out
            </IonButton>
          </form>
        </div>
      </IonContent>
    </IonPage>
  );
}
