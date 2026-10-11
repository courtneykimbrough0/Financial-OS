import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { todayLocal } from '../domain/dates';
import { buildSampleData } from '../domain/sample';
import { LocalStorageAdapter, SAMPLE_STORAGE_KEY, STORAGE_KEY, type StorageAdapter } from './storage';
import { StoreProvider } from './store';

export type DataMode = 'real' | 'sample';
const MODE_KEY = 'financial-os:mode';

interface ModeApi {
  mode: DataMode;
  /** Switches to a fresh copy of the sample data. Real data is left untouched. */
  enterSample: () => Promise<void>;
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

  const enterSample = useCallback(async () => {
    const sample = new LocalStorageAdapter(storage, SAMPLE_STORAGE_KEY);
    await sample.clear();
    const result = await sample.save(buildSampleData(todayLocal()), 0);
    if (!result.ok) throw new Error(result.message);
    storage.setItem(MODE_KEY, 'sample');
    setMode('sample');
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
