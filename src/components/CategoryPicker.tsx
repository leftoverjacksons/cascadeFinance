import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonModal,
  IonSearchbar,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { Fragment, useState } from 'react';
import { filterTree, type CategoryGroup } from '../domain/categories';

interface Props {
  isOpen: boolean;
  tree: CategoryGroup[];
  title?: string;
  /** Offer an "Uncategorized" choice (selects null). */
  allowNone?: boolean;
  noneLabel?: string;
  onSelect: (categoryId: string | null) => void;
  onCancel: () => void;
}

export default function CategoryPicker({
  isOpen,
  tree,
  title,
  allowNone,
  noneLabel = 'Uncategorized',
  onSelect,
  onCancel,
}: Props) {
  const [query, setQuery] = useState('');
  const visible = filterTree(tree, query);

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onCancel} onWillPresent={() => setQuery('')}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onCancel}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>{title ?? 'Category'}</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar
            value={query}
            onIonInput={(e) => setQuery(e.detail.value ?? '')}
            placeholder="Search categories"
          />
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList data-testid="category-picker">
          {allowNone && !query && (
            <IonItem button detail={false} onClick={() => onSelect(null)}>
              <IonLabel color="medium">{noneLabel}</IonLabel>
            </IonItem>
          )}
          {visible.map(({ group, children }) => (
            <Fragment key={group.id}>
              <IonItemDivider>{group.name}</IonItemDivider>
              {children.map((c) => (
                <IonItem key={c.id} button detail={false} onClick={() => onSelect(c.id)}>
                  <IonLabel>{c.name}</IonLabel>
                </IonItem>
              ))}
            </Fragment>
          ))}
        </IonList>
      </IonContent>
    </IonModal>
  );
}
