import { IonButton, IonContent, IonInput, IonItem, IonList, IonPage, useIonToast } from '@ionic/react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

export default function ResetPasswordPage() {
  const { finishRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      void toast({ message: error.message, duration: 4000, color: 'danger' });
    } else {
      void toast({ message: 'Password updated.', duration: 3000, color: 'success' });
      finishRecovery();
    }
  }

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <div className="narrow">
          <h1>Set a new password</h1>
          <form onSubmit={save}>
            <IonList inset>
              <IonItem>
                <IonInput
                  label="New password"
                  labelPlacement="stacked"
                  type="password"
                  autocomplete="new-password"
                  minlength={10}
                  value={password}
                  onIonInput={(e) => setPassword(e.detail.value ?? '')}
                  required
                />
              </IonItem>
            </IonList>
            <IonButton expand="block" type="submit" disabled={busy || password.length < 10}>
              Save password
            </IonButton>
          </form>
        </div>
      </IonContent>
    </IonPage>
  );
}
