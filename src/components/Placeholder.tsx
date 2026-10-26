import { IonContent, IonHeader, IonPage, IonText, IonTitle, IonToolbar } from '@ionic/react';
import type { ReactNode } from 'react';

/** Page shell for features scheduled in a later roadmap phase. */
export default function Placeholder({ title, children }: { title: string; children: ReactNode }) {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{title}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText color="medium">{children}</IonText>
      </IonContent>
    </IonPage>
  );
}
