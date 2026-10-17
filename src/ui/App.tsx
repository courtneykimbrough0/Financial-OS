import { useEffect } from 'react';
import { CreditCard, HandCoins, LayoutGrid, Receipt, RefreshCw, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';
import { useDataMode } from '../state/mode';
import { useAccountSlot } from '../state/slots';
import { useStore } from '../state/store';
import { DeviceDataOffer, RecoveredChangesNotice } from './components/account';
import { SaveStatusBar } from './components/backup';
import { Icon } from './components/common';
import { navigate, useRoute, type Route } from './router';
import { useWaitingUpdate } from './update';
import { Dashboard } from './screens/Dashboard';
import { Onboarding } from './screens/Onboarding';
import { Settings } from './screens/Settings';
import { ExpensesScreen, SourcesScreen } from './screens/SourcesScreen';

const NAV: { route: Route; label: string; icon: LucideIcon }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { route: 'income', label: 'Income', icon: HandCoins },
  { route: 'expenses', label: 'Expenses', icon: Receipt },
  { route: 'liabilities', label: 'Liabilities', icon: CreditCard },
];

/** Savings is a tab inside Expenses; its route highlights the Expenses tab. */
const navRoute = (r: Route): Route => (r === 'savings' ? 'expenses' : r);

export function App() {
  const { data } = useStore();
  const hashRoute = useRoute();
  const slot = useAccountSlot();
  const route: Route = hashRoute ?? (data.onboardingComplete ? 'dashboard' : 'onboarding');

  useEffect(() => {
    if (hashRoute === null) navigate(route);
  }, [hashRoute, route]);

  const titles: Record<Route, string> = {
    dashboard: 'Dashboard',
    income: 'Income',
    expenses: 'Expenses',
    liabilities: 'Liabilities',
    savings: 'Savings',
    settings: 'Settings',
    onboarding: 'Get started',
  };
  useEffect(() => {
    document.title = `${titles[route]} · Financial OS`;
  });

  const showNav = route !== 'onboarding';

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Financial OS
        </span>
        {showNav && (
          <nav className="top-nav" aria-label="Main">
            {NAV.map((n) => (
              <a key={n.route} href={`#/${n.route}`} aria-current={navRoute(route) === n.route ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
        )}
        {showNav && (
          <a className="icon-button settings-link" href="#/settings" aria-current={route === 'settings' ? 'page' : undefined} aria-label="Settings">
            <Icon icon={SettingsIcon} size={22} />
          </a>
        )}
      </header>
      <main id="main" className={showNav ? 'with-nav' : ''}>
        <SaveStatusBar />
        {slot && <slot.Guard />}
        <UpdateBanner />
        {data.isSample && <SampleBanner />}
        {route === 'onboarding' && <Onboarding />}
        {route === 'dashboard' && <Dashboard />}
        {route === 'income' && <SourcesScreen key="income" kind="income" />}
        {route === 'expenses' && <ExpensesScreen key="expenses" />}
        {route === 'savings' && <ExpensesScreen key="savings" initial="savings" />}
        {route === 'liabilities' && <SourcesScreen key="liability" kind="liability" />}
        {route === 'settings' && <Settings />}
        <RecoveredChangesNotice />
        <DeviceDataOffer />
      </main>
      {showNav && (
        <nav className="bottom-nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.route} href={`#/${n.route}`} aria-current={navRoute(route) === n.route ? 'page' : undefined}>
              <Icon icon={n.icon} size={24} className="nav-icon" />
              {n.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

function SampleBanner() {
  const { exitSample } = useDataMode();
  return (
    <div className="sample-banner" role="note">
      <p>
        <strong>You’re exploring sample data.</strong> Your own data stays unchanged.
      </p>
      <button
        type="button"
        className="button small secondary"
        onClick={() => {
          exitSample();
          window.location.hash = '';
        }}
      >
        Leave
        <span className="sr-only"> sample data</span>
      </button>
    </div>
  );
}

/** Shown when a new version is ready. Updating reloads the page, so it waits for a tap. */
function UpdateBanner() {
  const apply = useWaitingUpdate();
  const { saveStatus } = useStore();
  if (!apply) return null;
  return (
    <div className="sample-banner update-banner" role="status">
      <p>
        <strong>A new version of Financial OS is ready.</strong> Update when you’re done entering things.
      </p>
      <button type="button" className="button small secondary" onClick={apply} disabled={saveStatus === 'saving'}>
        <Icon icon={RefreshCw} size={16} /> Update
      </button>
    </div>
  );
}
