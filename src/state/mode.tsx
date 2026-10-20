import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { todayLocal } from '../domain/dates';
import { buildSampleData } from '../domain/sample';
import { LocalStorageAdapter, SAMPLE_STORAGE_KEY, STORAGE_KEY, type StorageAdapter } from './storage';
import { StoreProvider } from './store';

export type DataMode = 'real' | 'sample';
const MODE_KEY = 'financial-os:mode';

/** Shown when this device won't store the sample data (storage full, or blocked as in some private windows). */
export const SAMPLE_UNAVAILABLE = "Sample data couldn't be set up on this device. Check that this browser can store site data and has space, then try again.";

export type SampleResult = { ok: true } | { ok: false; message: string };

interface ModeApi {
  mode: DataMode;
  /**
   * Switches to a fresh copy of the sample data. Real data is left untouched.
   * Never throws: when the device can't store the sample, it stays on the
   * person's own data and says why.
   */
  enterSample: () => Promise<SampleResult>;
  /** Discards the sample data and returns to the user's own data. */
  exitSample: () => void;
}

const ModeContext = createContext<ModeApi | null>(null);

function readMode(storage: Storage): DataMode {
  try {
    return storage.getItem(MODE_KEY) === 'sample' && storage.getItem(SAMPLE_STORAGE_KEY) ? 'sample' : 'real';
  } catch {
    return 'real';
  }
}

/** Leaves sample mode and removes the sample data (e.g. when signing out). */
export function forgetSampleData(storage: Storage = window.localStorage) {
  storage.removeItem(SAMPLE_STORAGE_KEY);
  storage.removeItem(MODE_KEY);
}

/**
 * Chooses which storage the app reads and writes: the user's own (`adapter`,
 * their account when signed in, otherwise this device) or the sample data.
 * Sample data always lives on the device under its own key, so exploring it can
 * never mix synthetic transactions into the user's real data.
 */
export function DataModeProvider({ children, storage = window.localStorage, adapter: realAdapter }: { children: ReactNode; storage?: Storage; adapter?: StorageAdapter }) {
  const [mode, setMode] = useState<DataMode>(() => readMode(storage));
  const adapter = useMemo(
    () => (mode === 'sample' ? new LocalStorageAdapter(storage, SAMPLE_STORAGE_KEY) : (realAdapter ?? new LocalStorageAdapter(storage, STORAGE_KEY))),
    [storage, mode, realAdapter],
  );

  const enterSample = useCallback(async (): Promise<SampleResult> => {
    try {
      const sample = new LocalStorageAdapter(storage, SAMPLE_STORAGE_KEY);
      await sample.clear();
      const result = await sample.save(buildSampleData(todayLocal()), 0);
      if (!result.ok) return { ok: false, message: SAMPLE_UNAVAILABLE };
      storage.setItem(MODE_KEY, 'sample');
    } catch {
      // Leave nothing half set up: the person stays on their own data.
      try {
        storage.removeItem(SAMPLE_STORAGE_KEY);
      } catch {
        // Storage refuses even removal; there is nothing more to undo.
      }
      return { ok: false, message: SAMPLE_UNAVAILABLE };
    }
    setMode('sample');
    return { ok: true };
  }, [storage]);

  const exitSample = useCallback(() => {
    storage.removeItem(SAMPLE_STORAGE_KEY);
    storage.setItem(MODE_KEY, 'real');
    setMode('real');
  }, [storage]);

  const api = useMemo(() => ({ mode, enterSample, exitSample }), [mode, enterSample, exitSample]);
  return (
    <ModeContext.Provider value={api}>
      <StoreProvider key={mode} adapter={adapter}>
        {children}
      </StoreProvider>
    </ModeContext.Provider>
  );
}

export function useDataMode(): ModeApi {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error('useDataMode must be used inside DataModeProvider');
  return ctx;
}
