import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonRange,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useEffect, useState, type FormEvent } from 'react';
import { splitShares, weightsFromPercent } from '../domain/split';
import { useRequiredHousehold } from '../household/HouseholdProvider';
import { supabase } from '../lib/supabase';

export default function SettingsPage() {
  const { household, members, me, refresh } = useRequiredHousehold();
  const [toast] = useIonToast();
  const [email, setEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [busy, setBusy] = useState(false);

  const shares = splitShares(members.map((m) => ({ ...m, split_weight: Number(m.split_weight) })));
  const first = members[0];
  const second = members[1];
  const firstPercent = first ? Math.round((shares.get(first.user_id) ?? 0.5) * 100) : 50;
  const [percent, setPercent] = useState(firstPercent);
  // Re-sync when the saved split changes (e.g. after the partner is added).
  useEffect(() => setPercent(firstPercent), [firstPercent]);

  function fail(message: string) {
    void toast({ message, duration: 4000, color: 'danger' });
  }

  async function addMember(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('add_household_member', {
      p_email: email.trim(),
      p_display_name: memberName.trim(),
    });
    setBusy(false);
    if (error) return fail(error.message);
    setEmail('');
    setMemberName('');
    await refresh();
  }

  async function saveSplit() {
    if (!first || !second) return;
    const [w1, w2] = weightsFromPercent(percent);
    setBusy(true);
    const results = await Promise.all([
      supabase.from('household_members').update({ split_weight: w1 }).eq('user_id', first.user_id),
      supabase.from('household_members').update({ split_weight: w2 }).eq('user_id', second.user_id),
    ]);
    setBusy(false);
    const error = results.find((r) => r.error)?.error;
    if (error) return fail(error.message);
    void toast({ message: 'Split saved.', duration: 2000, color: 'success' });
    await refresh();
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Settings</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList inset>
          <IonListHeader>{household.name}</IonListHeader>
          {members.map((m) => (
            <IonItem key={m.user_id}>
              <IonLabel>
                {m.display_name}
                {m.user_id === me.user_id && <span className="muted"> (you)</span>}
              </IonLabel>
              <IonNote slot="end">{m.role}</IonNote>
            </IonItem>
          ))}
        </IonList>

        <IonList inset>
          <IonListHeader>Categorization</IonListHeader>
          <IonItem routerLink="/settings/categories" detail>
            <IonLabel>Categories</IonLabel>
          </IonItem>
          <IonItem routerLink="/settings/rules" detail>
            <IonLabel>Rules</IonLabel>
          </IonItem>
          <IonItem routerLink="/shared" detail>
            <IonLabel>Shared expenses and paybacks</IonLabel>
          </IonItem>
        </IonList>

        {me.role === 'owner' && members.length < 2 && (
          <form onSubmit={addMember}>
            <IonList inset>
              <IonListHeader>Add your partner</IonListHeader>
              <IonItem>
                <IonText color="medium">
                  <p className="hint">
                    First create their login in the Supabase dashboard (Authentication → Users),
                    then add them here by email.
                  </p>
                </IonText>
              </IonItem>
              <IonItem>
                <IonInput
                  label="Email"
                  labelPlacement="stacked"
                  type="email"
                  value={email}
                  onIonInput={(e) => setEmail(e.detail.value ?? '')}
                  required
                />
              </IonItem>
              <IonItem>
                <IonInput
                  label="Name"
                  labelPlacement="stacked"
                  value={memberName}
                  maxlength={50}
                  onIonInput={(e) => setMemberName(e.detail.value ?? '')}
                  required
                />
              </IonItem>
              <IonButton
                className="ion-margin"
                type="submit"
                disabled={busy || !email.trim() || !memberName.trim()}
              >
                Add member
              </IonButton>
            </IonList>
          </form>
        )}

        {first && second && (
          <IonList inset>
            <IonListHeader>Shared expense split</IonListHeader>
            <IonItem>
              <IonRange
                min={1}
                max={99}
                step={1}
                value={percent}
                onIonInput={(e) => setPercent(e.detail.value as number)}
                aria-label="Split percentage"
              >
                <div slot="start">{first.display_name} {percent}%</div>
                <div slot="end">{100 - percent}% {second.display_name}</div>
              </IonRange>
            </IonItem>
            <IonButton
              className="ion-margin"
              onClick={() => void saveSplit()}
              disabled={busy || percent === firstPercent}
            >
              Save split
            </IonButton>
          </IonList>
        )}

        <div className="ion-padding">
          <IonButton expand="block" color="medium" fill="outline" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
}
