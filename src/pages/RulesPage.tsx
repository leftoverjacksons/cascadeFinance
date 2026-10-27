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
  IonPage,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
  useIonViewWillEnter,
} from '@ionic/react';
import { useCallback, useEffect, useState } from 'react';
import RuleModal from '../components/RuleModal';
import { categoryLabel } from '../domain/categories';
import { BANK_MAPPING_PRIORITY, describeRule, type Rule } from '../domain/rules';
import { useAccounts } from '../household/useAccounts';
import { useCategories } from '../household/useCategories';
import { supabase } from '../lib/supabase';

export default function RulesPage() {
  const { tree, byId, refresh: refreshCategories } = useCategories();
  const { accounts } = useAccounts();
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showMappings, setShowMappings] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('category_rules')
      .select('*')
      .order('priority')
      .order('created_at')
      .order('id');
    if (error) setError(error.message);
    else setRules(data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useIonViewWillEnter(() => {
    void refreshCategories();
    void refresh();
  });

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'unknown account';
  const own = rules.filter((r) => r.priority < BANK_MAPPING_PRIORITY);
  const mappings = rules.filter((r) => r.priority >= BANK_MAPPING_PRIORITY);

  function openEditor(rule: Rule | null) {
    setEditing(rule);
    setOpen(true);
  }

  const row = (r: Rule) => (
    <IonItem key={r.id} button detail onClick={() => openEditor(r)}>
      <IonLabel className="ion-text-wrap">
        <h3>{categoryLabel(r.set_category_id, byId)}</h3>
        <p>{describeRule(r, accountName)}</p>
      </IonLabel>
    </IonItem>
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings" />
          </IonButtons>
          <IonTitle>Rules</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => openEditor(null)}>Add rule</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList inset>
          <IonItem lines="none">
            <IonText color="medium">
              <p className="hint">
                Rules are checked in order (lower priority first); the first match sets the
                category. Categories you choose by hand are never changed by rules. Saving a rule
                re-applies all rules immediately.
              </p>
            </IonText>
          </IonItem>
        </IonList>
        {error && (
          <IonText color="danger">
            <p className="ion-padding">{error}</p>
          </IonText>
        )}
        <IonList inset data-testid="own-rules">
          <IonListHeader>Your rules ({own.length})</IonListHeader>
          {own.length === 0 && (
            <IonItem lines="none">
              <IonText color="medium">None yet. Create one here or from a transaction.</IonText>
            </IonItem>
          )}
          {own.map(row)}
        </IonList>
        <IonList inset>
          <IonListHeader>Bank category mappings ({mappings.length})</IonListHeader>
          <IonItem>
            <IonToggle checked={showMappings} onIonChange={(e) => setShowMappings(e.detail.checked)}>
              Show
            </IonToggle>
          </IonItem>
          {showMappings && mappings.map(row)}
        </IonList>
      </IonContent>
      <RuleModal
        isOpen={open}
        rule={editing}
        tree={tree}
        byId={byId}
        accounts={accounts}
        onClose={(changed) => {
          setOpen(false);
          if (changed) void refresh();
        }}
      />
    </IonPage>
  );
}
