import { Mail } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AccountUser, AuthService } from '../../state/account';
import { Field, FormError, Icon } from '../components/common';

const RESEND_SECONDS = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email, then the code from the email. Signing in for the first time creates the account. */
export function SignIn({ auth, onSignedIn }: { auth: AuthService; onSignedIn: (user: AccountUser) => void }) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    document.title = 'Sign in · Financial OS';
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const send = async (address: string) => {
    if (!auth.sendCode) return;
    setBusy(true);
    setError(null);
    try {
      await auth.sendCode(address);
      setSentTo(address);
      setCode('');
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The code couldn’t be sent. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!auth.signInWithGoogle) return;
    setBusy(true);
    setError(null);
    try {
      const user = await auth.signInWithGoogle();
      onSignedIn(user);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('closed-by-user') && !msg.includes('cancelled')) {
        setError('Sign in could not be completed. Please try again.');
      }
      setBusy(false);
    }
  };

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) return setFieldError('Enter an email address, like name@example.com.');
    setFieldError(null);
    void send(address);
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth.verifyCode) return;
    const digits = code.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(digits)) return setFieldError('Enter the code from the email. It’s numbers only.');
    setFieldError(null);
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await auth.verifyCode(sentTo!, digits));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code didn’t work. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Financial OS
        </span>
      </header>
      <main id="main" className="sign-in stack-lg">
        {sentTo === null ? (
          <>
            <header className="onboarding-header">
              <h1>
                Sign in to Financial OS
              </h1>
              <p className="muted">Your forecast is saved to your account and ready on any device where you sign in. First time here? Signing in creates your account.</p>
            </header>
            <div className="stack">
              {auth.signInWithGoogle && (
                <button type="button" className="button primary full" disabled={busy} onClick={() => void handleGoogleSignIn()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 8 }}>
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  {busy ? 'Signing in…' : 'Continue with Google'}
                </button>
              )}
              {auth.sendCode && auth.signInWithGoogle && (
                <p className="hint center" style={{ margin: '8px 0' }}>or with email</p>
              )}
              {auth.sendCode && (
                <form className="stack" onSubmit={submitEmail} noValidate>
                  <Field label="Email" error={fieldError}>
                    {(p) => <input {...p} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!auth.signInWithGoogle} />}
                  </Field>
                  <button type="submit" className="button secondary full" disabled={busy}>
                    <Icon icon={Mail} size={18} /> {busy ? 'Sending…' : 'Email me a code'}
                  </button>
                </form>
              )}
              <FormError message={error} />
            </div>
          </>
        ) : (
          <>
            <header className="onboarding-header">
              <h1>
                Check your email
              </h1>
              <p className="muted">
                We sent a sign-in code to <strong>{sentTo}</strong>. Enter it below.
              </p>
            </header>
            <form className="stack" onSubmit={(e) => void submitCode(e)} noValidate>
              <Field label="Sign-in code" error={fieldError}>
                {(p) => (
                  <input
                    {...p}
                    className="code-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={12}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoFocus
                  />
                )}
              </Field>
              <FormError message={error} />
              <button type="submit" className="button primary full" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <div className="data-actions center-actions">
              <button type="button" className="button small link" disabled={busy || wait > 0} onClick={() => void send(sentTo)}>
                {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
              </button>
              <button
                type="button"
                className="button small link"
                onClick={() => {
                  setSentTo(null);
                  setError(null);
                  setFieldError(null);
                }}
              >
                Use a different email
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
