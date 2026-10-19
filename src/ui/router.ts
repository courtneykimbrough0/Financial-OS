import { useEffect, useState } from 'react';

/** The Plan screen's sections, one per group of financial items. */
export const PLAN_SECTIONS = ['income', 'expenses', 'liabilities', 'reserves'] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number];

export type Route = 'home' | 'forecast' | `plan/${PlanSection}` | 'settings' | 'onboarding';
const ROUTES: Route[] = ['home', 'forecast', ...PLAN_SECTIONS.map((s) => `plan/${s}` as const), 'settings', 'onboarding'];

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
  return REDIRECTS[path] ?? null;
}

export function navigate(route: Route) {
  window.location.hash = `/${route}`;
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
