import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { todayLocal, type DateStr } from '../domain/dates';
import type { Clock, Result } from '../domain/operations';
import type { AppData } from '../domain/types';
import type { SaveIntent, StorageAdapter } from './storage';

/**
 * idle: everything on screen is saved.
 * saving: a save is in progress.
 * error: the latest change could not be saved; retry is available.
 * conflict: newer data was saved elsewhere; reload to continue.
 */
export type SaveStatus = 'idle' | 'saving' | 'error' | 'conflict';

interface Store {
  data: AppData;
  today: DateStr;
  /**
   * Applies a pure operation to the latest data, shows the result right away,
   * and saves it in the background. Operations run against a ref, so two rapid
   * calls (e.g. a double tap) are applied in sequence and the second sees the
   * first's result; that is what lets the domain layer reject duplicate
   * completions. Returns the operation's result (validation errors), not the
   * save outcome, which is reported through `saveStatus`.
   */
  run: (op: (data: AppData, clock: Clock) => Result) => Result;
  /**
   * Restoring a backup (`replace`) or starting over (`reset`): the whole plan
   * at once, saved with that intent. Runs only when every earlier change is
   * saved, and on its own: nothing else is combined into it. With online-first
   * storage the new plan appears only once the save is confirmed; until then
   * the screen keeps the saved plan and other changes wait. If it fails,
   * `retryReplace` sends the same save again and `cancelReplace` drops it and
   * reloads what is actually saved. With device-backed storage it applies
   * like `run`.
   */
  replacePlan: (op: (data: AppData, clock: Clock) => Result, intent: Exclude<SaveIntent, 'update'>) => Promise<ReplaceOutcome>;
  retryReplace: () => Promise<ReplaceOutcome>;
  cancelReplace: () => void;
  saveStatus: SaveStatus;
  saveMessage: string | null;
  /** Try the last failed save again. */
  retrySave: () => void;
  /** Discard unsaved changes and load the latest saved data. */
  reload: () => void;
  /**
   * What's on screen that the storage hasn't confirmed, and the revision it is
   * based on; null when everything is saved. Read when the app is about to be
   * taken away (another account signed in on this device), so nothing
   * unconfirmed disappears unseen.
   */
  unsavedChanges: () => { data: AppData; baseRevision: number; intent: SaveIntent } | null;
  /** Unsaved changes that were set aside because newer data was saved elsewhere. */
  recoveredCopy: { data: AppData; savedAt: string } | null;
  dismissRecoveredCopy: () => void;
}

/** `canRetry`: the same restore or start over can be sent again (its outcome isn't known or it failed to send). */
export type ReplaceOutcome = { ok: true } | { ok: false; error: string; canRetry: boolean };

const BUSY = 'Saving your last change… Try this again in a moment.';
const CONFLICTED = 'Reload to see the latest version before making changes.';
const REPLACING = 'Wait until this finishes saving, or cancel it.';

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
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [loadCount, setLoadCount] = useState(0);
  const [recoveredCopy, setRecoveredCopy] = useState<Store['recoveredCopy']>(null);
  const today = useToday(todayOverride);
  const todayRef = useRef(today);
  todayRef.current = today;

  // Latest in-memory data, the revision it was last saved at, and save-loop state.
  const dataRef = useRef<AppData | null>(null);
  const savedRevision = useRef(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  /** Why saving is paused, if it is. */
  const blocked = useRef<'error' | 'conflict' | null>(null);
  /** Counts loads; a save result from before the latest load belongs to data no longer on screen. */
  const loadGen = useRef(0);
  /** The save currently on its way, if any; a load waits for it so it reads the saved result. */
  const inFlight = useRef<Promise<unknown> | null>(null);
  /** A restore or start over not yet confirmed by online-first storage: not on screen, and nothing else runs meanwhile. */
  const replacing = useRef<{ data: AppData; intent: Exclude<SaveIntent, 'update'> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGen.current += 1;
    setData(null);
    setLoadError(null);
    void (async () => {
      // Let a save that is still on its way finish first, so the load includes it.
      await inFlight.current?.catch(() => {});
      if (cancelled) return;
      let loaded: AppData;
      try {
        loaded = await adapter.load();
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setLoadError('Your data could not be loaded.');
        return;
      }
      if (cancelled) return;
      dataRef.current = loaded;
      savedRevision.current = loaded.revision;
      dirty.current = false;
      saving.current = false;
      blocked.current = null;
      replacing.current = null;
      setSaveStatus('idle');
      setSaveMessage(null);
      setRecoveredCopy(adapter.recoveredCopy?.() ?? null);
      setData(loaded);
      if (adapter.hasUnsavedChanges?.()) {
        dirty.current = true;
        void flushRef.current();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, loadCount]);

  /** Saves the newest data, one save at a time; changes made meanwhile are coalesced into the next save. */
  const flush = useCallback(async () => {
    if (saving.current || blocked.current || replacing.current || !dirty.current || !dataRef.current) return;
    saving.current = true;
    setSaveStatus('saving');
    const gen = loadGen.current;
    while (dirty.current && dataRef.current && !blocked.current) {
      dirty.current = false;
      const snapshot = dataRef.current;
      // Ordinary changes are always updates; a restore or start over goes through replacePlan.
      const pending = adapter.save(snapshot, savedRevision.current, 'update');
      inFlight.current = pending;
      let result: Awaited<typeof pending>;
      try {
        result = await pending;
      } finally {
        if (inFlight.current === pending) inFlight.current = null;
      }
      // Data was loaded again meanwhile: this result belongs to what was on screen before, so it changes nothing now.
      if (gen !== loadGen.current) return;
      if (result.ok) {
        savedRevision.current = result.revision;
        continue;
      }
      dirty.current = true;
      blocked.current = result.reason;
      setSaveStatus(result.reason);
      setSaveMessage(result.message);
    }
    saving.current = false;
    if (!blocked.current) {
      setSaveStatus('idle');
      setSaveMessage(null);
    }
  }, [adapter]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const run = useCallback<Store['run']>(
    (op) => {
      if (!dataRef.current) return { ok: false, error: 'Still loading. Try again in a moment.' };
      if (blocked.current === 'conflict') return { ok: false, error: CONFLICTED };
      if (replacing.current) return { ok: false, error: REPLACING };
      const result = op(dataRef.current, { today: todayRef.current, now: new Date().toISOString() });
      if (!result.ok) return result;
      dataRef.current = result.data;
      dirty.current = true;
      setData(result.data);
      void flush();
      return result;
    },
    [flush],
  );

  /** Sends the unconfirmed restore or start over (the same one each time, so a retry is recognized). */
  const sendReplace = useCallback(async (): Promise<ReplaceOutcome> => {
    const pend = replacing.current;
    if (!pend) return { ok: false, error: "There's nothing to save.", canRetry: false };
    if (saving.current) return { ok: false, error: REPLACING, canRetry: false };
    saving.current = true;
    setSaveStatus('saving');
    setSaveMessage(null);
    const gen = loadGen.current;
    const pending = adapter.save(pend.data, savedRevision.current, pend.intent);
    inFlight.current = pending;
    let result: Awaited<typeof pending>;
    try {
      result = await pending;
    } finally {
      if (inFlight.current === pending) inFlight.current = null;
    }
    if (gen !== loadGen.current) return { ok: false, error: 'Your data was reloaded first. Check it, then try again.', canRetry: false };
    saving.current = false;
    if (result.ok) {
      replacing.current = null;
      savedRevision.current = result.revision;
      const saved = { ...pend.data, revision: result.revision };
      dataRef.current = saved;
      setData(saved);
      setSaveStatus('idle');
      return { ok: true };
    }
    if (result.reason === 'conflict') {
      // Newer data elsewhere: nothing is replaced; reload to continue.
      replacing.current = null;
      blocked.current = 'conflict';
      setSaveStatus('conflict');
      setSaveMessage(result.message);
      return { ok: false, error: result.message, canRetry: false };
    }
    // Not confirmed. The screen still shows the saved plan; the same save can be sent again.
    setSaveStatus('idle');
    return { ok: false, error: result.message, canRetry: true };
  }, [adapter]);

  const replacePlan = useCallback<Store['replacePlan']>(
    async (op, intent) => {
      if (!adapter.onlineFirst) {
        const r = run(op);
        return r.ok ? { ok: true } : { ok: false, error: r.error, canRetry: false };
      }
      if (!dataRef.current) return { ok: false, error: 'Still loading. Try again in a moment.', canRetry: false };
      if (blocked.current === 'conflict') return { ok: false, error: CONFLICTED, canRetry: false };
      if (replacing.current) return { ok: false, error: REPLACING, canRetry: false };
      if (saving.current || dirty.current || blocked.current) return { ok: false, error: BUSY, canRetry: false };
      const r = op(dataRef.current, { today: todayRef.current, now: new Date().toISOString() });
      if (!r.ok) return { ok: false, error: r.error, canRetry: false };
      replacing.current = { data: r.data, intent };
      return sendReplace();
    },
    [adapter, run, sendReplace],
  );

  const retryReplace = useCallback(() => sendReplace(), [sendReplace]);

  /** Drops an unconfirmed restore or start over. Its outcome may be unknown, so load what is actually saved. */
  const cancelReplace = useCallback(() => {
    if (!replacing.current || saving.current) return;
    replacing.current = null;
    setLoadCount((n) => n + 1);
  }, []);

  const retrySave = useCallback(() => {
    if (blocked.current !== 'error') return;
    blocked.current = null;
    void flush();
  }, [flush]);

  const reload = useCallback(() => setLoadCount((n) => n + 1), []);

  const unsavedChanges = useCallback<Store['unsavedChanges']>(() => {
    // A restore or start over waiting for confirmation: the plan it would write, not the one on screen (nothing else runs meanwhile).
    if (replacing.current) return { data: replacing.current.data, baseRevision: savedRevision.current, intent: replacing.current.intent };
    const unconfirmed = dirty.current || saving.current || blocked.current !== null;
    return unconfirmed && dataRef.current ? { data: dataRef.current, baseRevision: savedRevision.current, intent: 'update' } : null;
  }, []);

  const dismissRecoveredCopy = useCallback(() => {
    adapter.discardRecoveredCopy?.();
    setRecoveredCopy(null);
  }, [adapter]);

  // Try a failed save again as soon as the connection returns.
  useEffect(() => {
    window.addEventListener('online', retrySave);
    return () => window.removeEventListener('online', retrySave);
  }, [retrySave]);

  // Warn before closing the page while a change is unsaved.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current || replacing.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const value = useMemo(
    () => (data ? { data, today, run, replacePlan, retryReplace, cancelReplace, saveStatus, saveMessage, retrySave, reload, unsavedChanges, recoveredCopy, dismissRecoveredCopy } : null),
    [data, today, run, replacePlan, retryReplace, cancelReplace, saveStatus, saveMessage, retrySave, reload, unsavedChanges, recoveredCopy, dismissRecoveredCopy],
  );

  if (loadError) {
    return (
      <div className="load-screen" role="alert">
        <p>{loadError}</p>
        <button type="button" className="button primary" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="load-screen" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>Loading your forecast…</p>
      </div>
    );
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
