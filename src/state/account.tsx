/**
 * Accounts. When accounts are turned on, people sign in with Google and their
 * data is saved to their account (see `firebase.ts`). Otherwise the app runs on
 * device storage only.
 *
 * This file holds only what the app needs from any sign-in service, so the
 * Firebase library loads only when accounts are on.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { StorageAdapter } from './storage';

export interface AccountUser {
  id: string;
  email: string;
}

/** Everything the app needs from the sign-in service. Methods throw an Error with a plain-language message. */
export interface AuthService {
  /** The signed-in user, from the saved session. Works offline. */
  currentUser(): Promise<AccountUser | null>;
  onSignedOut(callback: () => void): () => void;
  /** Rejects with an Error whose `cancelled` is true when the person closed the sign-in window. */
  signInWithGoogle(): Promise<AccountUser>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  adapterFor(user: AccountUser): StorageAdapter & { forgetDevice(): void };
}

/** Remembers who was last signed in, so the app can open offline when the session can't be refreshed. */
const LAST_USER_KEY = 'financial-os:account:last-user';

export function rememberUser(user: AccountUser | null) {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Only offline start-up depends on this.
  }
}

export function lastUser(): AccountUser | null {
  try {
    const text = localStorage.getItem(LAST_USER_KEY);
    return text ? (JSON.parse(text) as AccountUser) : null;
  } catch {
    return null;
  }
}

interface AccountApi {
  user: AccountUser;
  adapter: StorageAdapter & { forgetDevice(): void };
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AccountContext = createContext<AccountApi | null>(null);

/** The signed-in account, or null when the app runs on device storage only. */
export function useAccount(): AccountApi | null {
  return useContext(AccountContext);
}

/**
 * Shows sign-in until someone is signed in, then the app with their account's
 * storage. `signIn` renders the sign-in screen.
 */
export function AccountGate({ auth, signIn, children }: { auth: AuthService; signIn: (onSignedIn: (u: AccountUser) => void) => ReactNode; children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    auth.currentUser().then(
      (u) => !cancelled && setUser(u),
      () => !cancelled && setUser(null),
    );
    const stop = auth.onSignedOut(() => setUser(null));
    return () => {
      cancelled = true;
      stop();
    };
  }, [auth]);

  const adapter = useMemo(() => (user ? auth.adapterFor(user) : null), [auth, user]);

  const signOut = useCallback(async () => {
    adapter?.forgetDevice();
    await auth.signOut();
    setUser(null);
  }, [auth, adapter]);

  const deleteAccount = useCallback(async () => {
    await auth.deleteAccount();
    adapter?.forgetDevice();
    setUser(null);
  }, [auth, adapter]);

  const api = useMemo(() => (user && adapter ? { user, adapter, signOut, deleteAccount } : null), [user, adapter, signOut, deleteAccount]);

  if (user === undefined) {
    return (
      <div className="load-screen" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>Opening Financial OS…</p>
      </div>
    );
  }
  if (!api) return <>{signIn(setUser)}</>;
  return (
    <AccountContext.Provider key={api.user.id} value={api}>
      {children}
    </AccountContext.Provider>
  );
}
