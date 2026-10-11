import { useEffect, useState } from 'react';
import { CreditCard, HandCoins, LayoutGrid, Receipt, type LucideIcon } from 'lucide-react';
import { useAccount } from '../state/account';
import { useDataMode } from '../state/mode';
import { useStore } from '../state/store';
import { AccountActions, DeviceDataOffer, RecoveredChangesNotice } from './components/account';
import { DownloadBackupButton, RestoreBackupButton, SaveStatusBar } from './components/backup';
import { Icon, Modal } from './components/common';
import { navigate, useRoute, type Route } from './router';
import { Dashboard } from './screens/Dashboard';
import { Onboarding } from './screens/Onboarding';
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
      </header>
      <main id="main" className={showNav ? 'with-nav' : ''}>
        <SaveStatusBar />
        {data.isSample && <SampleBanner />}
        {route === 'onboarding' && <Onboarding />}
        {route === 'dashboard' && <Dashboard />}
        {route === 'income' && <SourcesScreen key="income" kind="income" />}
        {route === 'expenses' && <ExpensesScreen key="expenses" />}
        {route === 'savings' && <ExpensesScreen key="savings" initial="savings" />}
        {route === 'liabilities' && <SourcesScreen key="liability" kind="liability" />}
        {showNav && <DataNotice />}
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

/** States plainly where data lives, and offers sample data in its own separate space. */
function DataNotice() {
  const { data } = useStore();
  const account = useAccount();
  const { enterSample } = useDataMode();
  const [confirming, setConfirming] = useState(false);
  return (
    <footer className="data-notice">
      {account ? (
        <p>Your data is saved to your Financial OS account, with a copy on this device so it opens offline. Changes made offline are saved to your account when you reconnect.</p>
      ) : (
        <p>Your data is saved in this browser on this device only. It isn’t synced to other devices, and clearing your browser’s site data removes it. Download a backup to keep a copy or move it to another device.</p>
      )}
      {!data.isSample && (
        <div className="data-actions">
          <DownloadBackupButton />
          <RestoreBackupButton />
          <button type="button" className="button small link" onClick={() => setConfirming(true)}>
            Explore with sample data
          </button>
        </div>
      )}
      <AccountActions />
      {confirming && (
        <Modal title="Explore with sample data?" onClose={() => setConfirming(false)}>
          <div className="stack">
            <p>
              You’ll see a made-up example with a late paycheck, a bill that cost more than expected, an overdue bill, and a stretch where projected cash flow dips below $0.
            </p>
            <p>Sample data is kept separate from yours. Your own entries stay exactly as they are, and you can return to them anytime with “Leave” on the sample-data banner.</p>
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setConfirming(false)} data-autofocus>
                Not now
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  void enterSample().then(() => navigate('dashboard'));
                }}
              >
                Show sample data
              </button>
            </div>
          </div>
        </Modal>
      )}
    </footer>
  );
}
