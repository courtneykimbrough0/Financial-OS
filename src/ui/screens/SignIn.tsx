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

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) return setFieldError('Enter an email address, like name@example.com.');
    setFieldError(null);
    void send(address);
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
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
              <p className="muted">Your forecast is saved to your account and ready on any device where you sign in. We’ll email you a code to sign in. First time here? The same code creates your account.</p>
            </header>
            <form className="stack" onSubmit={submitEmail} noValidate>
              <Field label="Email" error={fieldError}>
                {(p) => <input {...p} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
              </Field>
              <FormError message={error} />
              <button type="submit" className="button primary full" disabled={busy}>
                <Icon icon={Mail} size={18} /> {busy ? 'Sending…' : 'Email me a code'}
              </button>
            </form>
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
