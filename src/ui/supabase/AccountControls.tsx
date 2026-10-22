/**
 * Account controls for the development Supabase build: who is signed in, sign
 * out, delete the account, turn a temporary identity into an account, and
 * what happens when a session ends while the app is open.
 *
 * Sign out ends this device's session; the account and its plan stay. Start
 * over (Settings, "Your data") erases the plan and keeps the account. Delete
 * account removes the account and its plan for good.
 */
import { AlertCircle, Download, LogOut, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { createBackup } from '../../state/backup';
import { useStore } from '../../state/store';
import { useSupabaseAccount } from '../../state/supabase/session';
import { downloadFile } from '../components/backup';
import { Field, FormError, Icon, Modal } from '../components/common';

/** True while something on screen isn't confirmed saved. */
function useUnsaved() {
  const { saveStatus } = useStore();
  return saveStatus !== 'idle';
}

function BackupButton({ label = 'Download a backup' }: { label?: string }) {
  const { data } = useStore();
  const [saved, setSaved] = useState<string | null>(null);
  if (saved) return <p role="status">Backup downloaded: {saved}</p>;
  return (
    <button
      type="button"
      className="button secondary full"
      onClick={() => {
        const { filename, text } = createBackup(data);
        downloadFile(filename, text);
        setSaved(filename);
      }}
    >
      <Icon icon={Download} size={18} /> {label}
    </button>
  );
}

function UnsavedNotice() {
  const { saveMessage, retrySave, saveStatus } = useStore();
  return (
    <div className="callout callout-warn stack-sm" role="alert">
      <p>
        <Icon icon={AlertCircle} size={16} /> Some of your changes aren't saved yet. {saveMessage ?? ''}
      </p>
      {saveStatus === 'error' && (
        <button type="button" className="button small secondary" onClick={retrySave}>
          <Icon icon={RefreshCw} size={16} /> Try saving again
        </button>
      )}
    </div>
  );
}

function SignOutDialog({ onClose }: { onClose: () => void }) {
  const account = useSupabaseAccount()!;
  const unsaved = useUnsaved();
  const [busy, setBusy] = useState(false);
  const temporary = account.user.anonymous;
  return (
    <Modal title="Sign out?" onClose={() => !busy && onClose()}>
      <div className="stack">
        {unsaved && <UnsavedNotice />}
        {unsaved ? (
          <p>Signing out now leaves those changes behind. Save them first, or download a backup to keep a copy.</p>
        ) : temporary ? (
          <p>This is a temporary identity: once you sign out, you can't sign back in to this plan. Add an email first, or download a backup to keep a copy.</p>
        ) : (
          <p>Your plan stays saved to your account. Sign in again on any device to see it.</p>
        )}
        {(unsaved || temporary) && <BackupButton />}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy} data-autofocus>
            Stay signed in
          </button>
          <button
            type="button"
            className={unsaved || temporary ? 'button danger' : 'button primary'}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void account.signOut();
            }}
          >
            {unsaved || temporary ? 'Sign out anyway' : 'Sign out'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteDialog({ onClose }: { onClose: () => void }) {
  const account = useSupabaseAccount()!;
  const unsaved = useUnsaved();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || unsaved || !password) return;
    setBusy(true);
    setError(null);
    const err = await account.deleteAccount(password);
    if (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal title="Delete your account?" onClose={() => !busy && onClose()}>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-label="Delete your account">
        <p>This permanently deletes your account and everything in your plan: every item, schedule and recorded payment. It can't be undone.</p>
        <p>To only clear your plan and keep your account, use Start over instead.</p>
        <BackupButton label="Download a backup first" />
        {unsaved ? (
          <UnsavedNotice />
        ) : (
          <Field label="Enter your password to confirm">{(p) => <input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        )}
        <FormError message={error} />
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy} data-autofocus>
            Keep my account
          </button>
          <button type="submit" className="button danger" disabled={busy || unsaved || !password}>
            {busy ? 'Deleting…' : 'Delete account permanently'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A temporary identity from an earlier development build: add an email (confirmed by link), then a password, keeping the same identity and plan. */
function KeepThisPlan() {
  const account = useSupabaseAccount()!;
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !email) return;
    setBusy(true);
    setError(null);
    const err = await account.addEmail(email);
    setBusy(false);
    if (err) setError(err);
    else setSent(true);
  };
  if (sent) {
    return (
      <div className="stack-sm">
        <p role="status">We sent a link to {email}. Open it in this browser to confirm it; then you'll choose a password.</p>
        <button type="button" className="button small secondary" onClick={() => void account.checkEmailConfirmed()}>
          I've confirmed it
        </button>
      </div>
    );
  }
  return (
    <form className="stack-sm" onSubmit={(e) => void submit(e)} noValidate aria-label="Keep this plan">
      <p>This plan belongs to a temporary development identity, which can't be signed back into. Add an email and a password to keep it as an account.</p>
      <Field label="Email">{(p) => <input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} />}</Field>
      <FormError message={error} />
      <button type="submit" className="button small primary" disabled={busy}>
        {busy ? 'Sending…' : 'Add email'}
      </button>
    </form>
  );
}

/** Settings: who is signed in, sign out, delete account. */
export function AccountCard() {
  const account = useSupabaseAccount();
  const [sheet, setSheet] = useState<'sign-out' | 'delete' | null>(null);
  if (!account) return null;
  return (
    <>
      <section className="card settings-card" aria-labelledby="settings-account">
        <h2 id="settings-account">Sign-in &amp; Security</h2>
        {account.user.anonymous ? <KeepThisPlan /> : (
          <p>
            Signed in as <strong>{account.user.email}</strong>
          </p>
        )}
        <div className="settings-actions">
          <button type="button" className="button small link" onClick={() => setSheet('sign-out')}>
            <Icon icon={LogOut} size={16} /> Sign out
          </button>
          {!account.user.anonymous && (
            <button type="button" className="button small danger-link" onClick={() => setSheet('delete')}>
              <Icon icon={Trash2} size={16} /> Delete account
            </button>
          )}
        </div>
      </section>
      {sheet === 'sign-out' && <SignOutDialog onClose={() => setSheet(null)} />}
      {sheet === 'delete' && <DeleteDialog onClose={() => setSheet(null)} />}
    </>
  );
}

/** Setup welcome screen: who is signed in. */
export function AccountLine() {
  const account = useSupabaseAccount();
  const [signingOut, setSigningOut] = useState(false);
  if (!account) return null;
  return (
    <>
      <p className="hint center">
        {account.user.anonymous ? 'Signed in with a temporary identity.' : `Signed in as ${account.user.email}.`}{' '}
        <button type="button" className="button small link inline-link" onClick={() => setSigningOut(true)}>
          Sign out
        </button>
      </p>
      {signingOut && <SignOutDialog onClose={() => setSigningOut(false)} />}
    </>
  );
}

/**
 * The session ended while the app was open (expired, or signed out elsewhere).
 * With nothing unsaved, back to sign-in. With unsaved changes, they stay on
 * screen and the person signs in again as the same account, then saves.
 */
export function SessionGuard() {
  const account = useSupabaseAccount();
  const { retrySave, saveStatus, unsavedChanges } = useStore();
  // Anything unconfirmed, including a restore or start over whose dialog is still open after a failure.
  const unsaved = saveStatus !== 'idle' || unsavedChanges() !== null;
  // If another account takes over this browser's session, the gate sets aside what this one hasn't saved.
  useEffect(() => {
    if (!account) return;
    account.setCapture(unsavedChanges);
    return () => account.setCapture(null);
  }, [account, unsavedChanges]);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const ended = account?.sessionEnded ?? false;

  useEffect(() => {
    if (ended && !unsaved) account!.leave('Your session ended. Sign in again to continue.');
  }, [ended, unsaved, account]);

  if (!account || !ended || !unsaved) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    const err = await account.reauthenticate(password);
    setBusy(false);
    if (err) return setError(err);
    setPassword('');
    retrySave();
  };
  return (
    <Modal title="Sign in again to save" onClose={() => undefined}>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-label="Sign in again">
        <p>Your session ended, so your latest changes aren't saved yet. They're still here.</p>
        {account.user.anonymous ? (
          <p>This temporary identity can't be signed back into. Download a backup to keep your changes.</p>
        ) : (
          <>
            <p>
              Signed in as <strong>{account.user.email}</strong>
            </p>
            <Field label="Password">{(p) => <input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <FormError message={error} />
            <button type="submit" className="button primary full" disabled={busy || !password}>
              {busy ? 'Signing in…' : 'Sign in and save'}
            </button>
          </>
        )}
        <BackupButton />
        {confirmLeave ? (
          <button type="button" className="button danger full" onClick={() => account.leave("You signed out. Changes that weren't saved were left behind.")}>
            Leave without saving
          </button>
        ) : (
          <button type="button" className="button small link" onClick={() => setConfirmLeave(true)}>
            Sign out without saving…
          </button>
        )}
      </form>
    </Modal>
  );
}
