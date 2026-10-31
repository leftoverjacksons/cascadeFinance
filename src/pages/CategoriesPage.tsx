import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
  useIonActionSheet,
  useIonAlert,
  useIonToast,
} from '@ionic/react';
import { useState } from 'react';
import { buildTree, KIND_LABELS, type Category, type CategoryKind } from '../domain/categories';
import { useRequiredHousehold } from '../household/HouseholdProvider';
import { useCategories } from '../household/useCategories';
import { supabase } from '../lib/supabase';

export default function CategoriesPage() {
  const { household } = useRequiredHousehold();
  const { categories, refresh } = useCategories();
  const [showArchived, setShowArchived] = useState(false);
  const [alert] = useIonAlert();
  // A second dialog controller: the kind step of "Add group" must not share
  // one with the name step (an Ionic alert hook manages one dialog at a time,
  // and closing the first would close the second).
  const [kindAlert] = useIonAlert();
  const [deleteAlert] = useIonAlert();
  const [actions] = useIonActionSheet();
  const [toast] = useIonToast();

  const tree = buildTree(categories, showArchived);

  async function run(op: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await op;
    if (error) void toast({ message: error.message, duration: 4000, color: 'danger' });
    await refresh();
  }

  function promptName(header: string, value: string, onOk: (name: string) => void) {
    void alert({
      header,
      inputs: [{ name: 'name', value, attributes: { maxlength: 60 }, placeholder: 'Name' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: (d: { name: string }) => {
            if (!d.name.trim()) return false;
            onOk(d.name.trim());
          },
        },
      ],
    });
  }

  // Two steps (name, then kind), each with its own dialog controller; the
  // second opens once the first has closed. (Sharing one controller made the
  // second dialog close as soon as it opened, so nothing happened.)
  function addGroup() {
    void alert({
      header: 'New group',
      inputs: [{ name: 'name', placeholder: 'Name', attributes: { maxlength: 60 } }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Next',
          role: 'confirm',
          handler: (d: { name: string }) => (d.name.trim() ? undefined : false),
        },
      ],
      onDidDismiss: (e) => {
        const name = (e.detail.data?.values?.name as string | undefined)?.trim();
        if (e.detail.role !== 'confirm' || !name) return;
        void kindAlert({
          header: `What kind of money is "${name}"?`,
          inputs: (Object.keys(KIND_LABELS) as CategoryKind[]).map((k, i) => ({
            type: 'radio' as const,
            label: KIND_LABELS[k],
            value: k,
            checked: i === 0,
          })),
          buttons: [
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Create',
              handler: (kind: CategoryKind) =>
                void run(
                  supabase.from('categories').insert({
                    household_id: household.id,
                    name,
                    kind,
                    sort_order: tree.length + 1,
                  }),
                ),
            },
          ],
        });
      },
    });
  }

  function addChild(group: Category, count: number) {
    promptName(`New category in ${group.name}`, '', (name) =>
      void run(
        supabase
          .from('categories')
          .insert({ household_id: household.id, parent_id: group.id, name, sort_order: count + 1 }),
      ),
    );
  }

  /**
   * Deletes a category (a group: with its categories) after saying how many
   * transactions it holds. They become uncategorised, and the remaining rules
   * get another go at them; rules that set it are removed.
   */
  async function confirmDelete(c: Category, isGroup: boolean) {
    const ids = [c.id, ...(isGroup ? categories.filter((x) => x.parent_id === c.id).map((x) => x.id) : [])];
    const { count, error } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .in('category_id', ids);
    if (error) return void toast({ message: error.message, duration: 4000, color: 'danger' });
    const n = count ?? 0;
    const what = isGroup && ids.length > 1 ? `"${c.name}" and its ${ids.length - 1} categories` : `"${c.name}"`;
    void deleteAlert({
      header: `Delete ${what}?`,
      message:
        (n === 0
          ? 'No transactions use it.'
          : `${n} transaction${n === 1 ? '' : 's'} will become uncategorised, then your other rules get another go at them.`) +
        ' Rules that set it are removed. This cannot be undone; Archive hides it instead.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => void run(supabase.rpc('delete_category', { p_category: c.id })),
        },
      ],
    });
  }

  function edit(c: Category, isGroup: boolean, childCount: number) {
    void actions({
      header: c.name,
      buttons: [
        {
          text: 'Rename',
          handler: () => promptName('Rename', c.name, (name) => void run(supabase.from('categories').update({ name }).eq('id', c.id))),
        },
        ...(isGroup
          ? [
              { text: 'Add category', handler: () => addChild(c, childCount) },
              {
                text: 'Share all its categories by default',
                handler: () => void run(supabase.from('categories').update({ is_shared: true }).eq('parent_id', c.id)),
              },
              {
                text: 'Share none of its categories by default',
                handler: () => void run(supabase.from('categories').update({ is_shared: false }).eq('parent_id', c.id)),
              },
              {
                text: 'Change kind',
                handler: () =>
                  void alert({
                    header: 'What kind of money?',
                    inputs: (Object.keys(KIND_LABELS) as CategoryKind[]).map((k) => ({
                      type: 'radio' as const,
                      label: KIND_LABELS[k],
                      value: k,
                      checked: k === c.kind,
                    })),
                    buttons: [
                      { text: 'Cancel', role: 'cancel' },
                      {
                        text: 'Save',
                        handler: (kind: CategoryKind) =>
                          void run(supabase.from('categories').update({ kind }).eq('id', c.id)),
                      },
                    ],
                  }),
              },
            ]
          : [
              {
                text: c.is_shared ? 'Stop sharing by default' : 'Shared with partner by default',
                handler: () => void run(supabase.from('categories').update({ is_shared: !c.is_shared }).eq('id', c.id)),
              },
            ]),
        ...(c.kind === 'transfer'
          ? []
          : [{ text: 'Delete…', role: 'destructive', handler: () => void confirmDelete(c, isGroup) }]),
        {
          text: c.is_archived ? 'Restore' : 'Archive',
          role: c.is_archived ? undefined : 'destructive',
          handler: () =>
            void run(supabase.from('categories').update({ is_archived: !c.is_archived }).eq('id', c.id)),
        },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings" />
          </IonButtons>
          <IonTitle>Categories</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={addGroup}>Add group</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList inset>
          <IonItem>
            <IonToggle checked={showArchived} onIonChange={(e) => setShowArchived(e.detail.checked)}>
              Show archived
            </IonToggle>
          </IonItem>
          <IonItem lines="none">
            <IonText color="medium">
              <p className="hint">
                Archived categories are hidden from pickers but keep their history. Groups marked
                Transfer are left out of spending and income totals. Categories marked "shared" are
                split with your partner when paid from one person's own account (see Shared).
              </p>
            </IonText>
          </IonItem>
        </IonList>
        {tree.map(({ group, children }) => (
          <IonList inset key={group.id}>
            <IonListHeader>
              <IonLabel>
                <button className="link-like" onClick={() => edit(group, true, children.length)}>
                  {group.name}
                </button>
                {group.kind !== 'expense' && (
                  <IonBadge color={group.kind === 'income' ? 'success' : 'medium'} className="kind-badge">
                    {group.kind}
                  </IonBadge>
                )}
                {group.is_archived && <IonNote> (archived)</IonNote>}
              </IonLabel>
              <IonButton size="small" onClick={() => addChild(group, children.length)}>
                Add
              </IonButton>
            </IonListHeader>
            {children.map((c) => (
              <IonItem key={c.id} button detail={false} onClick={() => edit(c, false, 0)}>
                <IonLabel color={c.is_archived ? 'medium' : undefined}>
                  {c.name}
                  {c.is_archived && ' (archived)'}
                </IonLabel>
                {c.is_shared && (
                  <IonNote slot="end" data-testid="shared-badge">
                    shared
                  </IonNote>
                )}
              </IonItem>
            ))}
          </IonList>
        ))}
      </IonContent>
    </IonPage>
  );
}
