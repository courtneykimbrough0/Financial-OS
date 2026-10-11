/**
 * Accounts. When the app is built with Supabase settings, people sign in with
 * a 6-digit code sent to their email and their data is saved to their account.
 * A code (rather than a sign-in link) keeps sign-in inside the installed app:
 * on iPhone a link would open Safari, which has separate storage.
 *
 * Without Supabase settings the app runs on device storage only, as before.
 */
import { createClient, isAuthRetryableFetchError, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CloudAdapter, supabaseBackend } from './cloud';
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
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<AccountUser>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  adapterFor(user: AccountUser): StorageAdapter & { forgetDevice(): void };
}

export function supabaseConfig(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  return url && key ? { url, key } : null;
}

/** Remembers who was last signed in, so the app can open offline when the session can't be refreshed. */
const LAST_USER_KEY = 'financial-os:account:last-user';

function rememberUser(user: AccountUser | null) {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Only offline start-up depends on this.
  }
}

function lastUser(): AccountUser | null {
  try {
    const text = localStorage.getItem(LAST_USER_KEY);
    return text ? (JSON.parse(text) as AccountUser) : null;
  } catch {
    return null;
  }
}

const toAccountUser = (u: User): AccountUser => ({ id: u.id, email: u.email ?? '' });

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('expired') || m.includes('invalid')) return 'That code didn’t work. It may have expired. Check the code or send a new one.';
  if (m.includes('rate limit') || m.includes('security purposes') || m.includes('too many')) return 'Too many tries. Wait a minute, then try again.';
  if (m.includes('fetch') || m.includes('network')) return 'Financial OS can’t connect right now. Check your connection and try again.';
  return message;
}

export function supabaseAuth(config: { url: string; key: string }): AuthService {
  const client: SupabaseClient = createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'financial-os:auth' },
  });
  return {
    async currentUser() {
      const { data, error } = await client.auth.getSession();
      if (data.session) {
        const user = toAccountUser(data.session.user);
        rememberUser(user);
        return user;
      }
      // Offline with a saved session: keep working from the device copy.
      if (error && isAuthRetryableFetchError(error)) return lastUser();
      return null;
    },
    onSignedOut(callback) {
      const { data } = client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') callback();
      });
      return () => data.subscription.unsubscribe();
    },
    async sendCode(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw new Error(friendly(error.message));
    },
    async verifyCode(email, code) {
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error || !data.user) throw new Error(friendly(error?.message ?? 'invalid'));
      const user = toAccountUser(data.user);
      rememberUser(user);
      return user;
    },
    async signOut() {
      rememberUser(null);
      // Local scope: signs out this device, and works offline.
      await client.auth.signOut({ scope: 'local' });
    },
    async deleteAccount() {
      const { error } = await client.rpc('delete_my_account');
      if (error) throw new Error(friendly(error.message));
      rememberUser(null);
      await client.auth.signOut({ scope: 'local' });
    },
    adapterFor(user) {
      return new CloudAdapter(supabaseBackend(client, user.id), user.id);
    },
  };
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
