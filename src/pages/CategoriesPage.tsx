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

  function addGroup() {
    void alert({
      header: 'New group',
      inputs: [
        { name: 'name', placeholder: 'Name', attributes: { maxlength: 60 } },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Next',
          handler: (d: { name: string }) => {
            if (!d.name.trim()) return false;
            void alert({
              header: 'What kind of money?',
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
                        name: d.name.trim(),
                        kind,
                        sort_order: tree.length + 1,
                      }),
                    ),
                },
              ],
            });
          },
        },
      ],
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
