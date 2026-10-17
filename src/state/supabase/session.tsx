/**
 * Supabase accounts for the development build: who is signed in, and the
 * app for exactly that person. Development only; see dev.tsx.
 *
 * - Each signed-in person gets their own app instance (keyed by user id) and
 *   their own storage adapter, so nothing in memory carries over to whoever
 *   signs in next on the device. Signing out unmounts it.
 * - Sessions are Supabase Auth's: kept by supabase-js in this browser's
 *   storage, refreshed automatically, and checked by the API on every request.
 * - A session that ends without signing out (expired, revoked elsewhere)
 *   doesn't throw the person out while changes are unsaved: `sessionEnded`
 *   is set and the Guard asks them to sign in again as the same account.
 * - The browser has one session for all its tabs. When another tab signs in
 *   as someone else, this tab's app is replaced by theirs. Anything it hadn't
 *   saved is first set aside (in memory, while the page is open) for its own
 *   account; the Recovery panel unlocks it only with that account's password.
 *   Every request is also bound to its account (`ownerBound`), so nothing of
 *   one account is ever sent under another's session.
 */
import type { AuthError, SupabaseClient, User } from '@supabase/supabase-js';
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { forgetSampleData } from '../mode';
import type { AppData } from '../../domain/types';
import { AccountSlotContext, type AccountSlot } from '../slots';
import type { StorageAdapter } from '../storage';
import { ownerBound, SupabaseStorageAdapter } from './adapter';

export interface AccountUser {
  id: string;
  email: string | null;
  /** An identity from an earlier development build, with no email or password: it can't be signed back into. */
  anonymous: boolean;
}

export interface SupabaseAccount {
  user: AccountUser;
  /** The session ended without signing out; saves are refused until the same person signs in again. */
  sessionEnded: boolean;
  signOut(): Promise<void>;
  /** After the session ended: signs in again as the same account, keeping the app and its unsaved changes. Returns an error message, or null. */
  reauthenticate(password: string): Promise<string | null>;
  /** Checks the password with a fresh sign-in, then permanently deletes the account and its plan. Returns an error message, or null. */
  deleteAccount(password: string): Promise<string | null>;
  /** Temporary identity → account, step 1: add an email (a confirmation link is sent). */
  addEmail(email: string): Promise<string | null>;
  /** Picks up an email confirmed from the link. */
  checkEmailConfirmed(): Promise<void>;
  /** Leaves the app for the sign-in screen (after the session ended with nothing unsaved). */
  leave(notice: string): void;
  /** The running app registers how to read what it hasn't saved, so a change of account can set it aside first. */
  setCapture(read: (() => Unsaved | null) | null): void;
}

export interface Unsaved {
  data: AppData;
  /** The revision the changes are based on: they're only ever saved on top of exactly that. */
  baseRevision: number;
}

/** Changes set aside when another account took over this browser's session. Kept in memory only. */
export interface SetAside extends Unsaved {
  id: string;
  owner: AccountUser;
  at: string;
}

const AccountContext = createContext<SupabaseAccount | null>(null);
export const useSupabaseAccount = () => useContext(AccountContext);

/** Set while a temporary identity is adding an email: once it's confirmed, the next step is a password. */
export const CONVERTING_KEY = 'financial-os:supabase-dev-converting';

/** Plain-language messages for Supabase Auth errors; none says whether an account exists. */
export function authMessage(error: AuthError | null | undefined): string {
  const code = error?.code ?? '';
  if (code === 'invalid_credentials') return 'That email and password don’t match an account. Check them and try again.';
  if (code === 'email_not_confirmed') return 'Confirm your email first: open the link we sent when you created your account.';
  if (code === 'weak_password') return 'Choose a longer password: at least 8 characters.';
  if (code === 'same_password') return 'Choose a password you haven’t used for this account.';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'Too many attempts. Wait a few minutes, then try again.';
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'Enter a valid email address.';
  if (code === 'email_exists') return 'That email can’t be used. Try another, or sign in to that account.';
  if ((error as { status?: number } | null)?.status === 0 || /fetch|network/i.test(error?.message ?? '')) return 'Couldn’t reach the server. Check your connection and try again.';
  return 'That didn’t work. Try again in a moment.';
}

const DELETED = 'Your account and everything in it were deleted.';

const toUser = (u: User): AccountUser => ({ id: u.id, email: u.email ?? null, anonymous: Boolean(u.is_anonymous) });

/** Where links in emails return: this page, without query or hash. */
export const returnAddress = () => `${window.location.origin}${window.location.pathname}`;

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out'; notice: string | null }
  /** Signed in from a recovery link, or a temporary identity whose email is now confirmed: choose a password. */
  | { kind: 'new-password'; reason: 'recovery' | 'converting'; user: AccountUser }
  | { kind: 'signed-in'; user: AccountUser };

export interface AuthScreens {
  SignedOut: ComponentType<{ client: SupabaseClient; notice: string | null }>;
  NewPassword: ComponentType<{ client: SupabaseClient; reason: 'recovery' | 'converting'; onDone: () => void }>;
  /** One set-aside change: unlock with its account's password (through `verifier`), then save or download it, or discard it. */
  Recovery: ComponentType<{ item: SetAside; verifier: () => SupabaseClient; onSaved: () => void; onDone: () => void }>;
}

export function SupabaseAccountGate({
  client,
  verifier,
  screens,
  slot,
  children,
}: {
  client: SupabaseClient;
  /** A separate client with its own in-memory session, for checking a password without touching the browser's session. */
  verifier: () => SupabaseClient;
  screens: AuthScreens;
  slot: AccountSlot;
  children: (adapter: StorageAdapter) => ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [sessionEnded, setSessionEnded] = useState(false);
  const [setAside, setSetAside] = useState<SetAside[]>([]);
  /** Bumped to load the app again (after a set-aside change was saved into the account on screen). */
  const [generation, setGeneration] = useState(0);
  const capture = useRef<(() => Unsaved | null) | null>(null);
  const leaving = useRef(false);
  /** Set from the link in a recovery email (see the sign-in screen). */
  const recovering = useRef(new URLSearchParams(window.location.search).get('recovery') === '1');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    // Links from emails return with ?code=… (and ?recovery=1); supabase-js reads them, then they're tidied away.
    const tidy = () => {
      const url = new URL(window.location.href);
      if (['code', 'recovery', 'error', 'error_code', 'error_description'].some((k) => url.searchParams.has(k))) {
        window.history.replaceState(null, '', `${url.pathname}${url.hash}`);
      }
    };
    const linkFailed = new URLSearchParams(window.location.search).has('code') || new URLSearchParams(window.location.search).has('error');

    const { data } = client.auth.onAuthStateChange((event, session) => {
      const current = phaseRef.current;
      if (event === 'PASSWORD_RECOVERY') recovering.current = true;
      if (!session) {
        if (event === 'INITIAL_SESSION') {
          tidy();
          setPhase({ kind: 'signed-out', notice: linkFailed ? 'If you opened a link from an email, sign in here to continue. Links work in the browser where you asked for them.' : null });
          return;
        }
        if (leaving.current || current.kind !== 'signed-in') {
          leaving.current = false;
          setSessionEnded(false);
          setPhase((p) => (p.kind === 'signed-out' ? p : { kind: 'signed-out', notice: null }));
          return;
        }
        // Ended without signing out: let the Guard decide (sign in again, or leave if nothing is unsaved).
        setSessionEnded(true);
        return;
      }
      const user = toUser(session.user);
      if (event === 'INITIAL_SESSION') tidy();
      if (recovering.current) {
        setPhase({ kind: 'new-password', reason: 'recovery', user });
        return;
      }
      if (!user.anonymous && localStorage.getItem(CONVERTING_KEY)) {
        setPhase({ kind: 'new-password', reason: 'converting', user });
        return;
      }
      setSessionEnded(false);
      // Someone else now holds this browser's session: set aside what the current account hasn't saved, then hand over.
      if (current.kind === 'signed-in' && current.user.id !== user.id) {
        const unsaved = capture.current?.();
        capture.current = null;
        if (unsaved) setSetAside((list) => [...list, { ...unsaved, id: crypto.randomUUID(), owner: current.user, at: new Date().toISOString() }]);
      }
      // Same person: keep the app (and anything unsaved). Anyone else: a fresh app for them.
      setPhase((p) => (p.kind === 'signed-in' && p.user.id === user.id && p.user.email === user.email && p.user.anonymous === user.anonymous ? p : { kind: 'signed-in', user }));
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  const user = phase.kind === 'signed-in' ? phase.user : null;
  // One adapter per person: it holds what it knows about unconfirmed saves, which must never carry over.
  const userId = user?.id ?? null;
  const adapter = useMemo(() => (userId ? new SupabaseStorageAdapter(ownerBound(client, userId)) : null), [client, userId]);

  // Set-aside changes live only in this page: leaving it asks first.
  useEffect(() => {
    if (setAside.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [setAside.length]);

  const setCapture = useCallback((read: (() => Unsaved | null) | null) => {
    capture.current = read;
  }, []);

  const leave = useCallback((notice: string) => {
    leaving.current = true;
    forgetSampleData();
    window.location.hash = '';
    setSessionEnded(false);
    setPhase({ kind: 'signed-out', notice });
    void client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }, [client]);

  const signOut = useCallback(async () => {
    leaving.current = true;
    forgetSampleData();
    window.location.hash = '';
    // Ends this device's session; the account and its plan stay on the server.
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setSessionEnded(false);
    setPhase({ kind: 'signed-out', notice: null });
  }, [client]);

  const reauthenticate = useCallback(
    async (password: string) => {
      if (!user?.email) return 'This identity can’t be signed back into.';
      const { data, error } = await client.auth.signInWithPassword({ email: user.email, password });
      if (error) return authMessage(error);
      if (data.user.id !== user.id) {
        await signOut();
        return 'That’s a different account.';
      }
      setSessionEnded(false);
      return null;
    },
    [client, user, signOut],
  );

  const deleteAccount = useCallback(
    async (password: string) => {
      if (!user?.email) return 'This identity has no password to confirm.';
      // A fresh password sign-in: the database requires one from the last 5 minutes.
      const check = await client.auth.signInWithPassword({ email: user.email, password });
      if (check.error) return check.error.code === 'invalid_credentials' ? 'That password isn’t right. Nothing was deleted.' : authMessage(check.error);
      const { error } = await client.rpc('delete_account');
      if (error) return `Your account wasn’t deleted. ${error.message}`;
      leave(DELETED);
      return null;
    },
    [client, user, leave],
  );

  const addEmail = useCallback(
    async (email: string) => {
      localStorage.setItem(CONVERTING_KEY, '1');
      const { error } = await client.auth.updateUser({ email }, { emailRedirectTo: returnAddress() });
      if (error) {
        localStorage.removeItem(CONVERTING_KEY);
        return authMessage(error);
      }
      return null;
    },
    [client],
  );

  const checkEmailConfirmed = useCallback(async () => {
    // A refreshed session carries the confirmed email; the gate then asks for a password.
    await client.auth.refreshSession();
  }, [client]);

  const account = useMemo<SupabaseAccount | null>(
    () => (user ? { user, sessionEnded, signOut, reauthenticate, deleteAccount, addEmail, checkEmailConfirmed, leave, setCapture } : null),
    [user, sessionEnded, signOut, reauthenticate, deleteAccount, addEmail, checkEmailConfirmed, leave, setCapture],
  );

  const recovery = setAside.map((item) => (
    <screens.Recovery
      key={item.id}
      item={item}
      verifier={verifier}
      onSaved={() => phaseRef.current.kind === 'signed-in' && phaseRef.current.user.id === item.owner.id && setGeneration((g) => g + 1)}
      onDone={() => setSetAside((list) => list.filter((x) => x.id !== item.id))}
    />
  ));

  let content: ReactNode;
  if (phase.kind === 'loading') {
    content = (
      <div className="load-screen" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>Opening Financial OS…</p>
      </div>
    );
  } else if (phase.kind === 'signed-out') {
    content = <screens.SignedOut client={client} notice={phase.notice} />;
  } else if (phase.kind === 'new-password') {
    const done = () => {
      recovering.current = false;
      localStorage.removeItem(CONVERTING_KEY);
      setPhase({ kind: 'signed-in', user: phase.user });
    };
    content = <screens.NewPassword client={client} reason={phase.reason} onDone={done} />;
  } else {
    content = (
      <AccountContext.Provider value={account}>
        <AccountSlotContext.Provider value={slot}>
          <Fragment key={`${phase.user.id}:${generation}`}>{children(adapter!)}</Fragment>
        </AccountSlotContext.Provider>
      </AccountContext.Provider>
    );
  }
  return (
    <>
      {recovery}
      {content}
    </>
  );
}
