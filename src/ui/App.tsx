import { useEffect, useState } from 'react';
import { HandCoins, LayoutGrid, PiggyBank, Receipt, ShoppingBag, type LucideIcon } from 'lucide-react';
import { useDataMode } from '../state/mode';
import { useStore } from '../state/store';
import { Icon, Modal } from './components/common';
import { navigate, useRoute, type Route } from './router';
import { Dashboard } from './screens/Dashboard';
import { Onboarding } from './screens/Onboarding';
import { ExpensesScreen, SourcesScreen } from './screens/SourcesScreen';

const NAV: { route: Route; label: string; icon: LucideIcon }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { route: 'income', label: 'Income', icon: HandCoins },
  { route: 'expenses', label: 'Expenses', icon: Receipt },
  { route: 'savings', label: 'Savings', icon: PiggyBank },
  { route: 'spending', label: 'Spending', icon: ShoppingBag },
];

/** Liabilities live under Expenses; its old route opens that tab. */
const navRoute = (r: Route): Route => (r === 'liabilities' ? 'expenses' : r);

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
    spending: 'Spending',
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
        {data.isSample && <SampleBanner />}
        {route === 'onboarding' && <Onboarding />}
        {route === 'dashboard' && <Dashboard />}
        {route === 'income' && <SourcesScreen key="income" kind="income" />}
        {route === 'expenses' && <ExpensesScreen key="expenses" />}
        {route === 'liabilities' && <ExpensesScreen key="liabilities" initial="liability" />}
        {route === 'savings' && <SourcesScreen key="savings" kind="savings" />}
        {route === 'spending' && <SourcesScreen key="spending" kind="spending" />}
        {showNav && <DataNotice />}
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
  const { enterSample } = useDataMode();
  const [confirming, setConfirming] = useState(false);
  return (
    <footer className="data-notice">
      <p>Your data is saved in this browser on this device only. It is not backed up or synced to other devices, and clearing your browser’s site data removes it.</p>
      {!data.isSample && (
        <button type="button" className="button small link" onClick={() => setConfirming(true)}>
          Explore with sample data
        </button>
      )}
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
                  enterSample();
                  navigate('dashboard');
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
