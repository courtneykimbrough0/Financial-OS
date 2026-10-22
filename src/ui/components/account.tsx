import { AlertCircle, Download, LogOut, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatMedium, todayLocal } from '../../domain/dates';
import { useAccount } from '../../state/account';
import { countItems, createBackup } from '../../state/backup';
import { hasPendingDeviceChanges } from '../../state/cloud';
import { forgetSampleData } from '../../state/mode';
import { migrate, STORAGE_KEY } from '../../state/storage';
import { useStore } from '../../state/store';
import type { AppData } from '../../domain/types';
import { navigate } from '../router';
import { downloadFile } from './backup';
import { Icon, Modal, useToast } from './common';

/** Settings card: signed-in email, sign out, and delete account. Renders nothing without an account. */
export function AccountActions() {
  const account = useAccount();
  const { data } = useStore();
  const [sheet, setSheet] = useState<'sign-out' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;

  const signOut = async () => {
    forgetSampleData();
    window.location.hash = '';
    await account.signOut();
  };

  const startSignOut = () => {
    if (hasPendingDeviceChanges(account.user.id)) setSheet('sign-out');
    else void signOut();
  };

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await account.deleteAccount();
      forgetSampleData();
      window.location.hash = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your account couldn't be deleted. Try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card settings-card" aria-labelledby="settings-account">
        <h2 id="settings-account">Sign-in &amp; Security</h2>
        <p>
          Signed in as <strong>{account.user.email}</strong>
        </p>
        <div className="settings-actions">
          <button type="button" className="button small link" onClick={startSignOut}>
            <Icon icon={LogOut} size={16} /> Sign out
          </button>
          <button type="button" className="button small danger-link" onClick={() => setSheet('delete')}>
            <Icon icon={Trash2} size={16} /> Delete account
          </button>
        </div>
      </section>

      {sheet === 'sign-out' && (
        <Modal title="Sign out now?" onClose={() => setSheet(null)}>
          <div className="stack">
            <p>Some of your changes haven't reached your account yet. Signing out removes them from this device.</p>
            <p>Stay signed in until you're back online and they'll be saved, or download a backup to keep a copy.</p>
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setSheet(null)} data-autofocus>
                Stay signed in
              </button>
              <button type="button" className="button danger" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </div>
        </Modal>
      )}

      {sheet === 'delete' && (
        <Modal title="Delete your account?" onClose={() => !busy && setSheet(null)}>
          <div className="stack">
            <p>
              This permanently deletes your account and everything saved in it from Financial OS. It can't be undone.
            </p>
            <p>Download a backup first if you want to keep a copy. You'll be asked to confirm with Google before anything is deleted.</p>
            <button
              type="button"
              className="button secondary full"
              onClick={() => {
                const { filename, text } = createBackup(data);
                downloadFile(filename, text);
              }}
            >
              <Icon icon={Download} size={18} /> Download backup
            </button>
            {error && (
              <p className="form-error" role="alert">
                <Icon icon={AlertCircle} size={16} /> {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setSheet(null)} disabled={busy} data-autofocus>
                Keep my account
              </button>
              <button type="button" className="button danger" onClick={() => void deleteAccount()} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Compact "Signed in as … · Sign out" for the setup welcome screen. */
export function SignedInLine() {
  const account = useAccount();
  useStore(); // Re-render as saves finish, so the pending check below stays current.
  if (!account) return null;
  // Signing out with unsent changes is handled by the full account controls, which warn first.
  if (hasPendingDeviceChanges(account.user.id)) return <p className="hint center">Signed in as {account.user.email}.</p>;
  return (
    <p className="hint center">
      Signed in as {account.user.email}.{' '}
      <button
        type="button"
        className="button small link inline-link"
        onClick={() => {
          forgetSampleData();
          void account.signOut();
        }}
      >
        Sign out
      </button>
    </p>
  );
}

/** Offers changes that were set aside (newer data came from elsewhere) as a backup download. */
export function RecoveredChangesNotice() {
  const { recoveredCopy, dismissRecoveredCopy } = useStore();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  if (!recoveredCopy) return null;
  const when = formatMedium(todayLocal(new Date(recoveredCopy.savedAt)));
  return (
    <Modal title="Changes from this device" onClose={() => setConfirmDiscard(true)}>
      <div className="stack">
        <p>
          Changes made on this device on {when} reached your account after newer changes from another device or window, so your forecast now shows the newer version.
        </p>
        <p>Download this device's changes as a backup file to keep them. You can open the file anytime to compare, or restore it to use that version instead.</p>
        {confirmDiscard && (
          <p className="callout callout-warn" role="alert">
            <Icon icon={AlertCircle} size={16} /> Discard removes this device's changes for good.
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={() => (confirmDiscard ? dismissRecoveredCopy() : setConfirmDiscard(true))}>
            {confirmDiscard ? 'Discard for good' : 'Discard'}
          </button>
          <button
            type="button"
            className="button primary"
            data-autofocus
            onClick={() => {
              const { filename, text } = createBackup(recoveredCopy.data, new Date(recoveredCopy.savedAt));
              downloadFile(filename.replace('backup', 'changes-from-this-device'), text);
              dismissRecoveredCopy();
            }}
          >
            <Icon icon={Download} size={18} /> Download them
          </button>
        </div>
      </div>
    </Modal>
  );
}

const MOVED_KEY = `${STORAGE_KEY}:moved-to-account`;
const offerDismissedKey = (userId: string) => `financial-os:account:${userId}:device-data-offer-dismissed`;

/** Data saved on this device before accounts, if there is any worth offering. */
function deviceData(): AppData | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    const data = migrate(JSON.parse(text));
    return countItems(data) > 0 ? data : null;
  } catch {
    return null;
  }
}

/**
 * The first time someone signs in to an empty account on a device that already
 * has a forecast, offer to move that forecast into the account.
 */
export function DeviceDataOffer() {
  const account = useAccount();
  const { data, run } = useStore();
  const toast = useToast();
  const [local] = useState(deviceData);
  const [dismissed, setDismissed] = useState(() => (account ? localStorage.getItem(offerDismissedKey(account.user.id)) === 'yes' : true));
  if (!account || !local || dismissed || data.isSample || data.revision !== 0 || countItems(data) > 0) return null;

  const items = countItems(local);
  const keepSeparate = () => {
    try {
      localStorage.setItem(offerDismissedKey(account.user.id), 'yes');
    } catch {
      // Worst case the offer appears again next time.
    }
    setDismissed(true);
  };
  const move = () => {
    const result = run((current) => ({ ok: true, data: { ...local, revision: current.revision } }));
    if (!result.ok) return;
    // Keep the device copy under another name rather than deleting it outright.
    try {
      localStorage.setItem(MOVED_KEY, localStorage.getItem(STORAGE_KEY) ?? '');
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The account now has the data; the device copy is only a spare.
    }
    setDismissed(true);
    toast('Your forecast is now saved to your account.');
    navigate(local.onboardingComplete ? 'home' : 'onboarding');
  };

  return (
    <Modal title="Move this device's forecast to your account?" onClose={keepSeparate}>
      <div className="stack">
        <p>
          This device has a forecast from before you signed in, with {items === 1 ? '1 item' : `${items} items`}. Move it into your account to keep using it here and on your other devices.
        </p>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={keepSeparate}>
            Start fresh
          </button>
          <button type="button" className="button primary" onClick={move} data-autofocus>
            Move to my account
          </button>
        </div>
      </div>
    </Modal>
  );
}
