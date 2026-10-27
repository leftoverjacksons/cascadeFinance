import {
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonTextarea,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { categoryLabel, type Category, type CategoryGroup } from '../domain/categories';
import { formatDay } from '../domain/dates';
import { formatCents } from '../domain/money';
import { suggestPattern } from '../domain/rulePattern';
import { useRequiredHousehold } from '../household/HouseholdProvider';
import type { LinkInfo } from '../household/useTransferLinks';
import { supabase } from '../lib/supabase';
import type { Transaction } from '../pages/TransactionsPage';
import CategoryPicker from './CategoryPicker';
import TransferSection from './TransferSection';

interface Props {
  transaction: Transaction | null;
  accountName: string;
  tree: CategoryGroup[];
  byId: Map<string, Category>;
  /** 'modal' (default) pops up over the page; 'panel' renders inline as a side panel (desktop). */
  presentation?: 'modal' | 'panel';
  /** changed: this row was saved; rulesChanged: other rows may have been re-categorised too. */
  onClose: (result: { changed: boolean; rulesChanged: boolean }) => void;
  /** Enables the transfer section (link status, confirm, unlink, link by hand). */
  transferLinks?: { byTxn: Map<string, LinkInfo>; accountName: (id: string) => string };
}

const AUTOMATIC = 'automatic';

export default function TransactionModal({
  transaction: t,
  accountName,
  tree,
  byId,
  presentation = 'modal',
  transferLinks,
  onClose,
}: Props) {
  const { household } = useRequiredHousehold();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  // A category id, or AUTOMATIC to hand the row back to the rules.
  const [category, setCategory] = useState<string>(AUTOMATIC);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [makeRule, setMakeRule] = useState(false);
  const [pattern, setPattern] = useState('');
  const [matching, setMatching] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast] = useIonToast();

  const pending = t?.status === 'pending';
  const initialCategory = t ? (t.category_source === 'manual' ? t.category_id! : AUTOMATIC) : AUTOMATIC;
  const categoryChanged = category !== initialCategory;
  const canMakeRule = category !== AUTOMATIC && !pending;

  useEffect(() => {
    if (!t) return;
    setName(t.display_description);
    setNotes(t.notes ?? '');
    setCategory(t.category_source === 'manual' ? t.category_id! : AUTOMATIC);
    setMakeRule(false);
    setPattern(suggestPattern(t.raw_description));
  }, [t]);

  // Live count of transactions the prospective rule would match.
  useEffect(() => {
    setMatching(null);
    if (!makeRule || pattern.trim().length < 2) return;
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('preview_category_rule', {
        p_field: 'description',
        p_match_type: 'contains',
        p_pattern: pattern.trim(),
      });
      setMatching(data?.[0]?.matching ?? 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [makeRule, pattern]);

  async function save() {
    if (!t) return;
    setBusy(true);
    try {
      const fields = { display_description: name.trim() || t.raw_description, notes: notes.trim() || null };
      const upd = await supabase.from('transactions').update(fields).eq('id', t.id);
      if (upd.error) throw upd.error;

      if (categoryChanged) {
        const r = await supabase.rpc('set_transaction_category', {
          p_ids: [t.id],
          p_category_id: (category === AUTOMATIC ? null : category) as string,
        });
        if (r.error) throw r.error;
      }

      let rulesChanged = false;
      if (makeRule && canMakeRule && pattern.trim()) {
        // Saving a rule re-categorises every non-manual transaction it matches.
        const r = await supabase.from('category_rules').insert({
          household_id: household.id,
          field: 'description',
          match_type: 'contains',
          pattern: pattern.trim(),
          set_category_id: category,
        });
        if (r.error) throw r.error;
        rulesChanged = true;
      }
      onClose({ changed: true, rulesChanged });
    } catch (e) {
      void toast({ message: (e as Error).message, duration: 5000, color: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const currentLabel =
    category === AUTOMATIC
      ? t?.category_source === 'rule'
        ? `${categoryLabel(t.category_id, byId)} (automatic)`
        : 'Uncategorized (automatic)'
      : categoryLabel(category, byId);

  const header = (
    <IonHeader>
      <IonToolbar>
        <IonButtons slot="start">
          <IonButton onClick={() => onClose({ changed: false, rulesChanged: false })}>Cancel</IonButton>
        </IonButtons>
        <IonTitle>Transaction</IonTitle>
        <IonButtons slot="end">
          <IonButton strong onClick={() => void save()} disabled={busy || pending}>
            Save
          </IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
  );

  const body = t && (
    <>
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
            {pending && ' (pending)'}
          </IonNote>
        </IonItem>
        <IonItem>
          <IonLabel>Account</IonLabel>
          <IonNote slot="end">{accountName}</IonNote>
        </IonItem>
        <IonItem>
          <IonLabel className="ion-text-wrap">
            <p>Bank description · bank category: {t.bank_category ?? '—'}</p>
            <h3 className="mono">{t.raw_description}</h3>
          </IonLabel>
        </IonItem>
      </IonList>

      <IonList inset>
        <IonItem
          button={!pending}
          detail={!pending}
          onClick={() => !pending && setPickerOpen(true)}
          data-testid="category-field"
        >
          <IonLabel className="ion-text-wrap">
            <p>Category</p>
            <h3>{currentLabel}</h3>
          </IonLabel>
        </IonItem>
        {category !== AUTOMATIC && !pending && (
          <IonItem button detail={false} onClick={() => setCategory(AUTOMATIC)}>
            <IonLabel color="primary">Reset to automatic (use rules)</IonLabel>
          </IonItem>
        )}
      </IonList>

      {transferLinks && (
        <TransferSection
          transaction={t}
          link={transferLinks.byTxn.get(t.id) ?? null}
          accountName={transferLinks.accountName}
          onChanged={() => onClose({ changed: true, rulesChanged: true })}
        />
      )}

      {canMakeRule && categoryChanged && (
        <IonList inset>
          <IonListHeader>Apply to similar transactions</IonListHeader>
          <IonItem>
            <IonCheckbox
              checked={makeRule}
              onIonChange={(e) => setMakeRule(e.detail.checked)}
              labelPlacement="end"
              justify="start"
            >
              Create a rule
            </IonCheckbox>
          </IonItem>
          {makeRule && (
            <>
              <IonItem>
                <IonInput
                  label="When the description contains"
                  labelPlacement="stacked"
                  value={pattern}
                  onIonInput={(e) => setPattern(e.detail.value ?? '')}
                />
              </IonItem>
              <IonItem lines="none">
                <IonNote>
                  {matching === null
                    ? 'Counting matches…'
                    : `Matches ${matching} transaction${matching === 1 ? '' : 's'}. Ones you set by hand keep their category.`}
                </IonNote>
              </IonItem>
            </>
          )}
        </IonList>
      )}

      <IonList inset>
        <IonItem>
          <IonInput
            label="Name"
            labelPlacement="stacked"
            value={name}
            disabled={pending}
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
            disabled={pending}
            onIonInput={(e) => setNotes(e.detail.value ?? '')}
          />
        </IonItem>
      </IonList>
      {pending && (
        <IonNote className="ion-padding" style={{ display: 'block' }}>
          Pending transactions are replaced by the next import, so they can't be edited until they post. Rules still
          categorise them.
        </IonNote>
      )}
      <CategoryPicker
        isOpen={pickerOpen}
        tree={tree}
        onCancel={() => setPickerOpen(false)}
        onSelect={(id) => {
          setPickerOpen(false);
          if (id) {
            setCategory(id);
            setMakeRule(true);
          }
        }}
      />
    </>
  );

  if (presentation === 'panel') {
    if (!t) return null;
    return (
      <aside className="side-panel" data-testid="transaction-detail" aria-label="Transaction details">
        {header}
        <div className="side-panel-body">{body}</div>
      </aside>
    );
  }

  return (
    <IonModal
      data-testid="transaction-detail"
      isOpen={t !== null}
      onDidDismiss={() => onClose({ changed: false, rulesChanged: false })}
    >
      {header}
      {body && <IonContent>{body}</IonContent>}
    </IonModal>
  );
}
