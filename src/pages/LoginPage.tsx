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
import { appRootUrl, supabase } from '../lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 4000, color: 'danger' });
  }

  async function forgot() {
    if (!email.trim()) {
      void toast({ message: 'Enter your email first.', duration: 3000 });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: appRootUrl(),
    });
    setBusy(false);
    void toast({
      message: error
        ? error.message
        : 'If that account exists, a reset link is on its way. Open it in this same browser.',
      duration: 6000,
      color: error ? 'danger' : 'success',
    });
  }

  return (
    <IonPage>
      <IonContent className="ion-padding">
        <div className="narrow">
          <h1>Cascade Finance</h1>
          <form onSubmit={signIn}>
            <IonList inset>
              <IonItem>
                <IonInput
                  label="Email"
                  labelPlacement="stacked"
                  type="email"
                  autocomplete="email"
                  value={email}
                  onIonInput={(e) => setEmail(e.detail.value ?? '')}
                  required
                />
              </IonItem>
              <IonItem>
                <IonInput
                  label="Password"
                  labelPlacement="stacked"
                  type="password"
                  autocomplete="current-password"
                  value={password}
                  onIonInput={(e) => setPassword(e.detail.value ?? '')}
                  required
                />
              </IonItem>
            </IonList>
            <IonButton expand="block" type="submit" disabled={busy}>
              Sign in
            </IonButton>
            <IonButton expand="block" fill="clear" onClick={forgot} disabled={busy}>
              Forgot password
            </IonButton>
          </form>
          <IonText color="medium">
            <p className="hint">Accounts are created by the household owner in Supabase.</p>
          </IonText>
        </div>
      </IonContent>
    </IonPage>
  );
}
