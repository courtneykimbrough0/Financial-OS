import { useEffect } from 'react';
import { useStore } from '../state/store';
import { navigate, useRoute, type Route } from './router';
import { Dashboard } from './screens/Dashboard';
import { Onboarding } from './screens/Onboarding';
import { SourcesScreen } from './screens/SourcesScreen';

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: '▦' },
  { route: 'income', label: 'Income', icon: '+' },
  { route: 'expenses', label: 'Expenses', icon: '−' },
  { route: 'liabilities', label: 'Liabilities', icon: '≡' },
];

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
    onboarding: 'Get started',
  };
  useEffect(() => {
    document.title = `${titles[route]} · Cash Flow Forecast`;
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
          Cash Flow Forecast
        </span>
        {showNav && (
          <nav className="top-nav" aria-label="Main">
            {NAV.map((n) => (
              <a key={n.route} href={`#/${n.route}`} aria-current={route === n.route ? 'page' : undefined}>
                {n.label}
              </a>
            ))}
          </nav>
        )}
      </header>
      <main id="main" className={showNav ? 'with-nav' : ''}>
        {route === 'onboarding' && <Onboarding />}
        {route === 'dashboard' && <Dashboard />}
        {route === 'income' && <SourcesScreen key="income" kind="income" />}
        {route === 'expenses' && <SourcesScreen key="expense" kind="expense" />}
        {route === 'liabilities' && <SourcesScreen key="liability" kind="liability" />}
      </main>
      {showNav && (
        <nav className="bottom-nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.route} href={`#/${n.route}`} aria-current={route === n.route ? 'page' : undefined}>
              <span className="nav-icon" aria-hidden="true">
                {n.icon}
              </span>
              {n.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
