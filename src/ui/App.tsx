import { useEffect } from 'react';
import { ClipboardList, History, House, ChartLine, RefreshCw, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';
import { useDataMode } from '../state/mode';
import { useAccountSlot } from '../state/slots';
import { useStore } from '../state/store';
import { DeviceDataOffer, RecoveredChangesNotice } from './components/account';
import { SaveStatusBar } from './components/backup';
import { Icon } from './components/common';
import { navigate, useRoute, type PlanSection, type Route } from './router';
import { useWaitingUpdate } from './update';
import { Forecast } from './screens/Forecast';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Activity } from './screens/Activity';
import { Settings } from './screens/Settings';
import { Plan } from './screens/Plan';

/** Main navigation. Plan opens its first section; any Plan section counts as Plan. */
const NAV: { route: Route; label: string; icon: LucideIcon; current: (r: Route) => boolean }[] = [
  { route: 'home', label: 'Home', icon: House, current: (r) => r === 'home' },
  { route: 'forecast', label: 'Forecast', icon: ChartLine, current: (r) => r === 'forecast' },
  { route: 'activity', label: 'Activity', icon: History, current: (r) => r === 'activity' },
  { route: 'plan/income', label: 'Plan', icon: ClipboardList, current: (r) => r.startsWith('plan/') },
];

export function App() {
  const { data } = useStore();
  const hashRoute = useRoute();
  const slot = useAccountSlot();
  const route: Route = hashRoute ?? (data.onboardingComplete ? 'home' : 'onboarding');

  useEffect(() => {
    if (hashRoute === null) navigate(route);
  }, [hashRoute, route]);

  const titles: Record<Route, string> = {
    home: 'Home',
    forecast: 'Forecast',
    activity: 'Activity',
    'plan/income': 'Income · Plan',
    'plan/expenses': 'Expenses · Plan',
    'plan/liabilities': 'Liabilities · Plan',
    'plan/reserves': 'Strategic Reserves · Plan',
    settings: 'Settings',
    onboarding: 'Get started',
  };
  useEffect(() => {
    document.title = `${titles[route]} · Financial OS`;
  });

  const showNav = route !== 'onboarding';

  return (
    <div className={showNav ? 'app with-nav' : 'app'}>
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
              <a key={n.route} href={`#/${n.route}`} aria-current={n.current(route) ? 'page' : undefined}>
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
      {/* The tab bar: fixed at the bottom on phones, the left rail from 1024px. It comes before the content so focus order matches the rail. */}
      {showNav && (
        <nav className="bottom-nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.route} href={`#/${n.route}`} aria-current={n.current(route) ? 'page' : undefined}>
              <Icon icon={n.icon} size={24} className="nav-icon" />
              {n.label}
            </a>
          ))}
        </nav>
      )}
      <main id="main" className={showNav ? 'with-nav' : ''}>
        <SaveStatusBar />
        {slot && <slot.Guard />}
        <UpdateBanner />
        {data.isSample && <SampleBanner />}
        {route === 'onboarding' && <Onboarding />}
        {route === 'home' && <Home />}
        {route === 'forecast' && <Forecast />}
        {route === 'activity' && <Activity />}
        {route.startsWith('plan/') && <Plan section={route.slice('plan/'.length) as PlanSection} />}
        {route === 'settings' && <Settings />}
        <RecoveredChangesNotice />
        <DeviceDataOffer />
      </main>
    </div>
  );
}

function SampleBanner() {
  const { exitSample } = useDataMode();
  return (
    <div className="sample-banner" role="note">
      <p>
        <strong>Sample data.</strong> Your own data stays unchanged.
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
        <strong>A new version of Financial OS is ready.</strong> Update when you're done entering things.
      </p>
      <button type="button" className="button small secondary" onClick={apply} disabled={saveStatus === 'saving'}>
        <Icon icon={RefreshCw} size={16} /> Update
      </button>
    </div>
  );
}
