import {
  IonApp,
  IonContent,
  IonIcon,
  IonLabel,
  IonPage,
  IonRouterOutlet,
  IonSpinner,
  IonSplitPane,
  IonTabBar,
  IonTabButton,
  IonTabs,
  IonText,
  setupIonicReact,
} from '@ionic/react';
import { IonReactHashRouter } from '@ionic/react-router';
import { Redirect, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { HouseholdProvider, useHousehold } from './household/HouseholdProvider';
import AccountsPage from './pages/AccountsPage';
import CategoriesPage from './pages/CategoriesPage';
import ImportPage from './pages/ImportPage';
import LoginPage from './pages/LoginPage';
import OverviewPage from './pages/OverviewPage';
import { DESKTOP_QUERY } from './layout/useMediaQuery';
import { NAV_ITEMS } from './layout/nav';
import Sidebar from './layout/Sidebar';
import { useOverlayAriaFix } from './layout/useOverlayAriaFix';
import RecurringPage from './pages/RecurringPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import RulesPage from './pages/RulesPage';
import SettingsPage from './pages/SettingsPage';
import SharedPage from './pages/SharedPage';
import SetupHouseholdPage from './pages/SetupHouseholdPage';
import TransactionsPage from './pages/TransactionsPage';
import TransfersPage from './pages/TransfersPage';

setupIonicReact();

function Loading() {
  return (
    <IonPage>
      <IonContent className="ion-padding">
        <div className="center">
          <IonSpinner />
        </div>
      </IonContent>
    </IonPage>
  );
}

function MainTabs() {
  useOverlayAriaFix();
  return (
    <IonReactHashRouter>
      <IonSplitPane contentId="main" when={DESKTOP_QUERY}>
        <Sidebar />
        {/* The split pane's main content; tabs handle routing on every size. */}
        <div id="main" className="ion-page">
          <IonTabs>
            <IonRouterOutlet>
              <Route exact path="/overview" component={OverviewPage} />
              <Route exact path="/transactions" component={TransactionsPage} />
              <Route exact path="/transfers" component={TransfersPage} />
              <Route exact path="/shared" component={SharedPage} />
              <Route exact path="/recurring" component={RecurringPage} />
              <Route exact path="/import" component={ImportPage} />
              <Route exact path="/accounts" component={AccountsPage} />
              <Route exact path="/settings" component={SettingsPage} />
              <Route exact path="/settings/categories" component={CategoriesPage} />
              <Route exact path="/settings/rules" component={RulesPage} />
              <Route exact path="/">
                <Redirect to="/overview" />
              </Route>
            </IonRouterOutlet>
            <IonTabBar slot="bottom">
              {NAV_ITEMS.filter((n) => n.phoneTab).map((n) => (
                <IonTabButton key={n.tab} tab={n.tab} href={n.href}>
                  <IonIcon icon={n.icon} />
                  <IonLabel>{n.label}</IonLabel>
                </IonTabButton>
              ))}
            </IonTabBar>
          </IonTabs>
        </div>
      </IonSplitPane>
    </IonReactHashRouter>
  );
}

function SignedIn() {
  const { loading, error, household } = useHousehold();
  if (loading && !household) return <Loading />;
  if (error)
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <IonText color="danger">{error}</IonText>
        </IonContent>
      </IonPage>
    );
  return household ? <MainTabs /> : <SetupHouseholdPage />;
}

function Gate() {
  const { session, loading, recovering } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <LoginPage />;
  if (recovering) return <ResetPasswordPage />;
  return (
    <HouseholdProvider>
      <SignedIn />
    </HouseholdProvider>
  );
}

export default function App() {
  return (
    <IonApp>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </IonApp>
  );
}
