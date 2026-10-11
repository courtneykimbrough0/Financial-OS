import { useEffect, useState } from 'react';

export type Route = 'dashboard' | 'income' | 'expenses' | 'liabilities' | 'savings' | 'spending' | 'onboarding';
const ROUTES: Route[] = ['dashboard', 'income', 'expenses', 'liabilities', 'savings', 'spending', 'onboarding'];

function parse(hash: string): Route | null {
  const r = hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(r) ? r : null;
}

export function navigate(route: Route) {
  window.location.hash = `/${route}`;
}

/** Minimal hash router: works offline and from any static host. */
export function useRoute(): Route | null {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo?.(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
