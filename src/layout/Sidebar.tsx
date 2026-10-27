import { IonContent, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonMenu, IonNote } from '@ionic/react';
import { useLocation } from 'react-router-dom';
import { useHousehold } from '../household/HouseholdProvider';
import { NAV_ITEMS } from './nav';

/** Desktop navigation; shown permanently by the split pane on wide screens. */
export default function Sidebar() {
  const { pathname } = useLocation();
  const { household, me } = useHousehold();
  return (
    <IonMenu contentId="main" type="overlay" className="sidebar">
      <IonContent>
        <IonList lines="none">
          <IonListHeader>
            <IonLabel>
              <h1 className="brand">Cascade</h1>
              <IonNote>
                {household?.name}
                {me && ` · ${me.display_name}`}
              </IonNote>
            </IonLabel>
          </IonListHeader>
          {NAV_ITEMS.map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            return (
              <IonItem
                key={n.tab}
                routerLink={n.href}
                routerDirection="root"
                detail={false}
                className={active ? 'nav-active' : ''}
                aria-current={active ? 'page' : undefined}
                data-nav={n.tab}
              >
                <IonIcon slot="start" icon={n.icon} aria-hidden="true" />
                <IonLabel>{n.label}</IonLabel>
              </IonItem>
            );
          })}
        </IonList>
      </IonContent>
    </IonMenu>
  );
}
