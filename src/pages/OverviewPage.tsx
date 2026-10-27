import {
  IonContent,
  IonHeader,
  IonLabel,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonViewWillEnter,
} from '@ionic/react';
import { lazy, Suspense, useCallback, useState } from 'react';
import { PERIODS, useDashboardModel } from '../dashboard/model';
import { PANELS } from '../dashboard/panels';
import { useAccounts } from '../household/useAccounts';
import { useCategories } from '../household/useCategories';
import { useOverview } from '../household/useOverview';
import { useIsDesktop } from '../layout/useMediaQuery';

// Desktop only: keeps the grid library out of the phone bundle.
const Workspace = lazy(() => import('../dashboard/Workspace'));

export default function OverviewPage() {
  const { data, error, refresh } = useOverview();
  const { byId, refresh: refreshCategories } = useCategories();
  const { accounts, refresh: refreshAccounts } = useAccounts();
  const [period, setPeriod] = useState<number>(12);
  const isDesktop = useIsDesktop();
  const model = useDashboardModel(data, byId, accounts, period);

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshCategories(), refreshAccounts()]);
  }, [refresh, refreshCategories, refreshAccounts]);

  useIonViewWillEnter(() => void refreshAll());

  const noData = data && data.totals.length === 0;

  const periodSegment = (
    <IonSegment value={String(period)} onIonChange={(e) => setPeriod(Number(e.detail.value))}>
      {PERIODS.map((p) => (
        <IonSegmentButton key={p} value={String(p)}>
          <IonLabel>{p} months</IonLabel>
        </IonSegmentButton>
      ))}
    </IonSegment>
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Overview</IonTitle>
          {isDesktop && (
            <div slot="end" className="period-end">
              {periodSegment}
            </div>
          )}
        </IonToolbar>
        {!isDesktop && <IonToolbar>{periodSegment}</IonToolbar>}
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={(e) => void refreshAll().then(() => e.detail.complete())}>
          <IonRefresherContent />
        </IonRefresher>
        {error && (
          <IonText color="danger">
            <p className="ion-padding">{error}</p>
          </IonText>
        )}
        {!data && !error && (
          <div className="center">
            <IonSpinner />
          </div>
        )}
        {noData && (
          <IonText color="medium">
            <p className="ion-padding">Import transactions to see your overview.</p>
          </IonText>
        )}
        {model && !noData && isDesktop && (
          <Suspense
            fallback={
              <div className="center">
                <IonSpinner />
              </div>
            }
          >
            <Workspace model={model} onDataChanged={() => void refresh()} />
          </Suspense>
        )}
        {model && !noData && !isDesktop && (
          <div className="stack">
            {PANELS.filter((p) => p.mobile).map(({ id, title, caption, Body }) => (
              <section key={id} className={`card panel-${id}`} data-panel={id}>
                {id !== 'kpis' && <h2>{title}</h2>}
                {caption && <p className="caption">{caption(model)}</p>}
                <Body model={model} fill={false} onDataChanged={() => void refresh()} />
              </section>
            ))}
          </div>
        )}
      </IonContent>
    </IonPage>
  );
}
