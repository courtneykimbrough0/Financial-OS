import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { todayLocal, type DateStr } from '../domain/dates';
import type { Clock, Result } from '../domain/operations';
import type { AppData } from '../domain/types';
import type { StorageAdapter } from './storage';

interface Store {
  data: AppData;
  today: DateStr;
  /**
   * Applies a pure operation to the latest data and saves it. Operations run
   * against a ref, so two rapid calls (e.g. a double tap) are applied in
   * sequence and the second sees the first's result; that is what lets the
   * domain layer reject duplicate completions.
   */
  run: (op: (data: AppData, clock: Clock) => Result) => Result;
}

const StoreContext = createContext<Store | null>(null);

function useToday(override?: DateStr): DateStr {
  const [today, setToday] = useState(() => override ?? todayLocal());
  useEffect(() => {
    if (override) return;
    // Refresh after midnight and when the app returns to the foreground so
    // overdue status stays accurate.
    const refresh = () => setToday(todayLocal());
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [override]);
  return today;
}

export function StoreProvider({ adapter, today: todayOverride, children }: { adapter: StorageAdapter; today?: DateStr; children: ReactNode }) {
  const [data, setData] = useState<AppData>(() => adapter.load());
  const dataRef = useRef(data);
  const today = useToday(todayOverride);
  const todayRef = useRef(today);
  todayRef.current = today;

  const run = useCallback<Store['run']>(
    (op) => {
      const result = op(dataRef.current, { today: todayRef.current, now: new Date().toISOString() });
      if (!result.ok) return result;
      try {
        adapter.save(result.data);
      } catch (err) {
        console.error(err);
        return { ok: false, error: 'Your change could not be saved on this device. Check available storage and try again.' };
      }
      dataRef.current = result.data;
      setData(result.data);
      return result;
    },
    [adapter],
  );

  const value = useMemo(() => ({ data, today, run }), [data, today, run]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
