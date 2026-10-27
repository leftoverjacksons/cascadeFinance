import {
  IonApp,
  IonContent,
  IonIcon,
  IonLabel,
  IonPage,
  IonRouterOutlet,
  IonSpinner,
  IonTabBar,
  IonTabButton,
  IonTabs,
  IonText,
  setupIonicReact,
} from '@ionic/react';
import { IonReactHashRouter } from '@ionic/react-router';
import { cloudUploadOutline, homeOutline, listOutline, settingsOutline, walletOutline } from 'ionicons/icons';
import { Redirect, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { HouseholdProvider, useHousehold } from './household/HouseholdProvider';
import AccountsPage from './pages/AccountsPage';
import CategoriesPage from './pages/CategoriesPage';
import ImportPage from './pages/ImportPage';
import LoginPage from './pages/LoginPage';
import OverviewPage from './pages/OverviewPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import RulesPage from './pages/RulesPage';
import SettingsPage from './pages/SettingsPage';
import SetupHouseholdPage from './pages/SetupHouseholdPage';
import TransactionsPage from './pages/TransactionsPage';

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
  return (
    <IonReactHashRouter>
      <IonTabs>
        <IonRouterOutlet>
          <Route exact path="/overview" component={OverviewPage} />
          <Route exact path="/transactions" component={TransactionsPage} />
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
          <IonTabButton tab="overview" href="/overview">
            <IonIcon icon={homeOutline} />
            <IonLabel>Overview</IonLabel>
          </IonTabButton>
          <IonTabButton tab="transactions" href="/transactions">
            <IonIcon icon={listOutline} />
            <IonLabel>Transactions</IonLabel>
          </IonTabButton>
          <IonTabButton tab="import" href="/import">
            <IonIcon icon={cloudUploadOutline} />
            <IonLabel>Import</IonLabel>
          </IonTabButton>
          <IonTabButton tab="accounts" href="/accounts">
            <IonIcon icon={walletOutline} />
            <IonLabel>Accounts</IonLabel>
          </IonTabButton>
          <IonTabButton tab="settings" href="/settings">
            <IonIcon icon={settingsOutline} />
            <IonLabel>Settings</IonLabel>
          </IonTabButton>
        </IonTabBar>
      </IonTabs>
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
