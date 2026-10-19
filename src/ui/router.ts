import { useEffect, useState } from 'react';
import type { DateStr } from '../domain/dates';

/** The Plan screen's sections, one per group of financial items. */
export const PLAN_SECTIONS = ['income', 'expenses', 'liabilities', 'reserves'] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number];

export type Route = 'home' | 'forecast' | 'activity' | `plan/${PlanSection}` | 'settings' | 'onboarding';
const ROUTES: Route[] = ['home', 'forecast', 'activity', ...PLAN_SECTIONS.map((s) => `plan/${s}` as const), 'settings', 'onboarding'];

/** Earlier addresses, kept working: each opens its new place and replaces the address in the history. */
const REDIRECTS: Record<string, Route> = {
  dashboard: 'forecast',
  plan: 'plan/income',
  income: 'plan/income',
  expenses: 'plan/expenses',
  liabilities: 'plan/liabilities',
  reserves: 'plan/reserves',
};

/** The route for an address, following an earlier address to its new place. */
export function parse(hash: string): Route | null {
  const path = hash.replace(/^#\/?/, '');
  if ((ROUTES as string[]).includes(path)) return path as Route;
  if (/^forecast\/\d{4}-\d{2}-\d{2}$/.test(path)) return 'forecast';
  return REDIRECTS[path] ?? null;
}

export function navigate(route: Route) {
  window.location.hash = `/${route}`;
}

let _forecastDate: DateStr | null = null;

/** Navigate to Forecast with an initial focus date (e.g. from Home's week view). */
export function navigateToForecast(date: DateStr) {
  _forecastDate = date;
  window.location.hash = `/forecast`;
}

/** Read and clear the date passed by `navigateToForecast`. Called once by Forecast on mount. */
export function consumeForecastDate(): DateStr | null {
  const d = _forecastDate;
  _forecastDate = null;
  return d;
}

/** Extract a date from a `#/forecast/YYYY-MM-DD` hash, for direct links. */
export function parseForecastDate(): DateStr | null {
  const m = window.location.hash.match(/^#\/forecast\/(\d{4}-\d{2}-\d{2})$/);
  return m ? (m[1] as DateStr) : null;
}

/** Rewrites an earlier address to its route's own, without adding a history entry. */
function canonicalize(route: Route | null) {
  if (route && window.location.hash !== `#/${route}`) window.history.replaceState(window.history.state, '', `#/${route}`);
}

/** Minimal hash router: works offline and from any static host. */
export function useRoute(): Route | null {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    canonicalize(parse(window.location.hash));
    const onChange = () => {
      const next = parse(window.location.hash);
      canonicalize(next);
      setRoute(next);
      window.scrollTo?.(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
