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
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { categoryLabel, type Category, type CategoryGroup } from '../domain/categories';
import type { Account } from '../domain/accounts';
import { parseAmountToCents } from '../domain/money';
import { FIELD_LABELS, MATCH_LABELS, type Rule, type RuleField, type RuleMatch } from '../domain/rules';
import { useRequiredHousehold } from '../household/HouseholdProvider';
import { supabase } from '../lib/supabase';
import CategoryPicker from './CategoryPicker';

interface Props {
  isOpen: boolean;
  rule: Rule | null;
  tree: CategoryGroup[];
  byId: Map<string, Category>;
  accounts: Account[];
  onClose: (changed: boolean) => void;
}

const ANY = 'any';

function centsToInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

export default function RuleModal({ isOpen, rule, tree, byId, accounts, onClose }: Props) {
  const { household } = useRequiredHousehold();
  const [field, setField] = useState<RuleField>('description');
  const [match, setMatch] = useState<RuleMatch>('contains');
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(ANY);
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [priority, setPriority] = useState('100');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<{ matching: number; manual: number; examples: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();

  useEffect(() => {
    if (!isOpen) return;
    setField(rule?.field ?? 'description');
    setMatch(rule?.match_type ?? 'contains');
    setPattern(rule?.pattern ?? '');
    setCategoryId(rule?.set_category_id ?? null);
    setAccountId(rule?.account_id ?? ANY);
    setMinText(centsToInput(rule?.amount_min_cents ?? null));
    setMaxText(centsToInput(rule?.amount_max_cents ?? null));
    setPriority(String(rule?.priority ?? 100));
  }, [isOpen, rule]);

  const min = minText.trim() ? parseAmountToCents(minText) : null;
  const max = maxText.trim() ? parseAmountToCents(maxText) : null;
  const amountsValid =
    (!minText.trim() || (min !== null && min >= 0)) &&
    (!maxText.trim() || (max !== null && max >= 0)) &&
    (min === null || max === null || min <= max);
  const priorityValue = Number.parseInt(priority, 10);
  const priorityValid = Number.isInteger(priorityValue) && priorityValue >= 0;

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!isOpen || !pattern.trim() || !amountsValid) return;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('preview_category_rule', {
        p_field: field,
        p_match_type: match,
        p_pattern: pattern.trim(),
        ...(accountId === ANY ? {} : { p_account_id: accountId }),
        ...(min === null ? {} : { p_amount_min_cents: min }),
        ...(max === null ? {} : { p_amount_max_cents: max }),
      });
      if (error) setPreviewError(error.message);
      else if (data?.[0]) setPreview({ ...data[0], examples: data[0].examples ?? [] });
    }, 300);
    return () => clearTimeout(timer);
  }, [isOpen, field, match, pattern, accountId, min, max, amountsValid]);

  async function save() {
    if (!categoryId) return;
    setBusy(true);
    const fields = {
      field,
      match_type: match,
      pattern: pattern.trim(),
      set_category_id: categoryId,
      account_id: accountId === ANY ? null : accountId,
      amount_min_cents: min,
      amount_max_cents: max,
      priority: priorityValue,
    };
    const { error } = rule
      ? await supabase.from('category_rules').update(fields).eq('id', rule.id)
      : await supabase.from('category_rules').insert({ ...fields, household_id: household.id });
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 5000, color: 'danger' });
    else onClose(true);
  }

  async function remove() {
    if (!rule) return;
    setBusy(true);
    const { error } = await supabase.from('category_rules').delete().eq('id', rule.id);
    setBusy(false);
    if (error) void toast({ message: error.message, duration: 5000, color: 'danger' });
    else onClose(true);
  }

  const valid = pattern.trim() && categoryId && amountsValid && priorityValid && !previewError;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={() => onClose(false)}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => onClose(false)}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>{rule ? 'Edit rule' : 'New rule'}</IonTitle>
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
            <IonSelect label="When" value={field} onIonChange={(e) => setField(e.detail.value as RuleField)}>
              {Object.entries(FIELD_LABELS).map(([v, l]) => (
                <IonSelectOption key={v} value={v}>
                  {l}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonSelect label="Match" value={match} onIonChange={(e) => setMatch(e.detail.value as RuleMatch)}>
              {Object.entries(MATCH_LABELS).map(([v, l]) => (
                <IonSelectOption key={v} value={v}>
                  {l}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonInput
              label="Text"
              labelPlacement="stacked"
              placeholder={match === 'regex' ? 'e.g. ^(publix|kroger)' : 'e.g. publix'}
              value={pattern}
              maxlength={200}
              onIonInput={(e) => setPattern(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem button detail onClick={() => setPickerOpen(true)} data-testid="rule-category">
            <IonLabel>Set category</IonLabel>
            <IonNote slot="end">{categoryId ? categoryLabel(categoryId, byId) : 'Choose…'}</IonNote>
          </IonItem>
        </IonList>

        <IonList inset>
          <IonItem>
            <IonSelect label="Only for account" value={accountId} onIonChange={(e) => setAccountId(e.detail.value as string)}>
              <IonSelectOption value={ANY}>Any account</IonSelectOption>
              {accounts.map((a) => (
                <IonSelectOption key={a.id} value={a.id}>
                  {a.name}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
          <IonItem>
            <IonInput
              label="Amount at least (optional)"
              labelPlacement="stacked"
              inputmode="decimal"
              value={minText}
              onIonInput={(e) => setMinText(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="Amount at most (optional)"
              labelPlacement="stacked"
              inputmode="decimal"
              value={maxText}
              onIonInput={(e) => setMaxText(e.detail.value ?? '')}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="Priority (lower runs first)"
              labelPlacement="stacked"
              inputmode="numeric"
              value={priority}
              onIonInput={(e) => setPriority(e.detail.value ?? '')}
            />
          </IonItem>
          {!amountsValid && (
            <IonItem lines="none">
              <IonNote color="danger">Amounts must be positive and the minimum no larger than the maximum.</IonNote>
            </IonItem>
          )}
        </IonList>

        <IonList inset>
          <IonItem lines="none">
            <IonLabel className="ion-text-wrap">
              {previewError ? (
                <IonNote color="danger">{previewError}</IonNote>
              ) : preview ? (
                <>
                  <h3 data-testid="rule-preview">
                    Matches {preview.matching} transaction{preview.matching === 1 ? '' : 's'}
                    {preview.manual > 0 && ` (${preview.manual} set by hand will not change)`}
                  </h3>
                  {preview.examples.length > 0 && <p>e.g. {preview.examples.join(', ')}</p>}
                </>
              ) : (
                <IonNote>Enter text to see what this rule matches.</IonNote>
              )}
            </IonLabel>
          </IonItem>
        </IonList>

        {rule && (
          <div className="ion-padding narrow-block">
            <IonButton expand="block" color="danger" fill="outline" disabled={busy} onClick={() => void remove()}>
              Delete rule
            </IonButton>
          </div>
        )}
        <CategoryPicker
          isOpen={pickerOpen}
          tree={tree}
          onCancel={() => setPickerOpen(false)}
          onSelect={(id) => {
            setPickerOpen(false);
            setCategoryId(id);
          }}
        />
      </IonContent>
    </IonModal>
  );
}
