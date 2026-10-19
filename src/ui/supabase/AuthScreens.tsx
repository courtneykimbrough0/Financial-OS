/**
 * Email-and-password accounts (Supabase Auth) for the development build:
 * sign in, create an account, confirm the email, recover a password, and
 * choose a new one. Nothing financial is asked for here; a new account starts
 * setup as usual. Messages never say whether an account exists for an email.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { authMessage, returnAddress } from '../../state/supabase/session';
import { Field, FormError } from '../components/common';

export const MIN_PASSWORD = 8;

function Shell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Financial OS`;
  }, [title]);
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Financial OS
        </span>
      </header>
      <main id="main" className="sign-in stack-lg">
        <header className="onboarding-header">
          <h1>{title}</h1>
          {intro && <p className="muted">{intro}</p>}
        </header>
        {children}
      </main>
    </div>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Field label="Email">{(p) => <input {...p} type="email" autoComplete="email" inputMode="email" required value={value} onChange={(e) => onChange(e.target.value.trim())} />}</Field>;
}

function PasswordField({ label = 'Password', value, onChange, isNew, hint }: { label?: string; value: string; onChange: (v: string) => void; isNew?: boolean; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      {(p) => <input {...p} type="password" autoComplete={isNew ? 'new-password' : 'current-password'} required minLength={isNew ? MIN_PASSWORD : undefined} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

type Mode = 'sign-in' | 'sign-up' | 'check-email' | 'forgot' | 'forgot-sent';

/** Sign in, or create an account, or ask for a password-reset link. */
export function SignedOutScreen({ client, notice }: { client: SupabaseClient; notice: string | null }) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState(false);

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setUnconfirmed(false);
    setResent(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!email) return setError('Enter your email.');
    if (mode !== 'forgot' && !password) return setError('Enter your password.');
    if (mode === 'sign-up' && password.length < MIN_PASSWORD) return setError(`Choose a password with at least ${MIN_PASSWORD} characters.`);
    setBusy(true);
    try {
      if (mode === 'sign-in') {
        const { error: err } = await client.auth.signInWithPassword({ email, password });
        if (err) {
          setUnconfirmed(err.code === 'email_not_confirmed');
          setError(authMessage(err));
        }
        // On success the session changes and the app opens.
      } else if (mode === 'sign-up') {
        const { data, error: err } = await client.auth.signUp({ email, password, options: { emailRedirectTo: returnAddress() } });
        // "Already registered" gets the same answer as a new sign-up, so this screen never says which emails have accounts.
        if (err && err.code !== 'user_already_exists') setError(authMessage(err));
        else if (!data?.session) go('check-email');
      } else {
        const { error: err } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${returnAddress()}?recovery=1` });
        if (err) setError(authMessage(err));
        else go('forgot-sent');
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    const { error: err } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: returnAddress() } });
    if (err) setError(authMessage(err));
    else setResent(true);
  };

  if (mode === 'check-email' || mode === 'forgot-sent') {
    return (
      <Shell title="Check your email">
        <div className="stack">
          <p role="status">
            {mode === 'check-email'
              ? `If ${email} can be used for a new account, we’ve sent a link to it. Open it in this browser to finish creating your account. If you already have an account, sign in instead.`
              : `If there’s an account for ${email}, we’ve sent a link to choose a new password. Open it in this browser.`}
          </p>
          <button type="button" className="button secondary full" onClick={() => go('sign-in')}>
            Back to sign in
          </button>
        </div>
      </Shell>
    );
  }

  const copy = {
    'sign-in': { title: 'Sign in to Financial OS', intro: 'Your forecast is saved to your account and ready on any device where you sign in.', action: 'Sign in', busy: 'Signing in…' },
    'sign-up': { title: 'Create your account', intro: 'Just an email and a password. You’ll set up your forecast next.', action: 'Create account', busy: 'Creating your account…' },
    forgot: { title: 'Reset your password', intro: 'Enter your account’s email and we’ll send a link to choose a new password.', action: 'Send the link', busy: 'Sending…' },
  }[mode];

  return (
    <Shell title={copy.title} intro={copy.intro}>
      {notice && (
        <p className="callout callout-info" role="status">
          {notice}
        </p>
      )}
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-label={copy.title}>
        <EmailField value={email} onChange={setEmail} />
        {mode !== 'forgot' && <PasswordField value={password} onChange={setPassword} isNew={mode === 'sign-up'} hint={mode === 'sign-up' ? `At least ${MIN_PASSWORD} characters.` : undefined} />}
        <FormError message={error} />
        {unconfirmed &&
          (resent ? (
            <p role="status">We sent the link again.</p>
          ) : (
            <button type="button" className="button small link" onClick={() => void resend()}>
              Send the confirmation link again
            </button>
          ))}
        <button type="submit" className="button primary full" disabled={busy}>
          {busy ? copy.busy : copy.action}
        </button>
      </form>
      <div className="stack-sm center">
        {mode === 'sign-in' ? (
          <>
            <button type="button" className="button small link" onClick={() => go('sign-up')}>
              Create an account
            </button>
            <button type="button" className="button small link" onClick={() => go('forgot')}>
              Forgot your password?
            </button>
          </>
        ) : (
          <button type="button" className="button small link" onClick={() => go('sign-in')}>
            Back to sign in
          </button>
        )}
      </div>
    </Shell>
  );
}

/** Choose a password: after a recovery link, or to finish turning a temporary identity into an account. */
export function NewPasswordScreen({ client, reason, onDone }: { client: SupabaseClient; reason: 'recovery' | 'converting'; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD) return setError(`Choose a password with at least ${MIN_PASSWORD} characters.`);
    setBusy(true);
    setError(null);
    const { error: err } = await client.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(authMessage(err));
    onDone();
  };
  return (
    <Shell
      title={reason === 'recovery' ? 'Choose a new password' : 'Choose a password'}
      intro={reason === 'recovery' ? 'Your email is confirmed. Choose a new password for your account.' : 'Your email is confirmed. Choose a password, and you can sign in to this plan from any device.'}
    >
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-label="Choose a password">
        <PasswordField label="New password" value={password} onChange={setPassword} isNew hint={`At least ${MIN_PASSWORD} characters.`} />
        <FormError message={error} />
        <button type="submit" className="button primary full" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </Shell>
  );
}
