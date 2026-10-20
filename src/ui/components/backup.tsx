import { AlertCircle, Download, RefreshCw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatMedium, todayLocal } from '../../domain/dates';
import * as ops from '../../domain/operations';
import { countItems, createBackup, readBackup, type ParsedBackup } from '../../state/backup';
import { useStore, type ReplaceOutcome } from '../../state/store';
import { navigate } from '../router';
import { Icon, Modal, useToast } from './common';

export function downloadFile(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const itemsText = (n: number) => (n === 1 ? '1 item' : `${n} items`);

/**
 * Before anything replaces or erases the person's data: how much is there now,
 * and a button to download it first. Shows nothing when there's nothing to lose.
 */
function KeepACopy() {
  const { data } = useStore();
  const [saved, setSaved] = useState<string | null>(null);
  const count = countItems(data);
  if (count === 0) return null;
  return (
    <div className="callout callout-info stack-sm keep-copy">
      <p>
        You have {itemsText(count)} now. To keep a copy, download a backup first. You can restore it later.
      </p>
      {saved ? (
        <p role="status">Backup downloaded: {saved}</p>
      ) : (
        <button
          type="button"
          className="button small secondary"
          onClick={() => {
            const { filename, text } = createBackup(data);
            downloadFile(filename, text);
            setSaved(filename);
          }}
        >
          <Icon icon={Download} size={16} /> Download a backup of your data
        </button>
      )}
    </div>
  );
}

export function DownloadBackupButton() {
  const { data } = useStore();
  const toast = useToast();
  return (
    <button
      type="button"
      className="button small link"
      onClick={() => {
        const { filename, text } = createBackup(data);
        downloadFile(filename, text);
        toast(`Backup downloaded: ${filename}`);
      }}
    >
      <Icon icon={Download} size={16} /> Download backup
    </button>
  );
}

/**
 * A restore or start over in progress: busy while it saves, and when it isn't
 * confirmed, the reason and whether the same save can be tried again. Only a
 * confirmed save closes the dialog and reports success.
 */
function useReplace(onDone: () => void) {
  const { replacePlan, retryReplace, cancelReplace } = useStore();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: string; canRetry: boolean } | null>(null);
  const settle = (r: ReplaceOutcome) => {
    setBusy(false);
    if (r.ok) {
      setFailure(null);
      onDone();
    } else setFailure({ error: r.error, canRetry: r.canRetry });
  };
  return {
    busy,
    failure,
    start: async (...args: Parameters<typeof replacePlan>) => {
      if (busy) return;
      setBusy(true);
      settle(await replacePlan(...args));
    },
    retry: async () => {
      if (busy) return;
      setBusy(true);
      settle(await retryReplace());
    },
    /** Closes without replacing; an unconfirmed save is dropped and what's saved is loaded again. */
    cancel: () => {
      if (busy) return false;
      if (failure?.canRetry) cancelReplace();
      setFailure(null);
      return true;
    },
  };
}

/** Pick a backup file, confirm, then replace the app's data with it. */
export function RestoreBackupButton({ label = 'Restore from backup' }: { label?: string }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replace = useReplace(() => {
    const restored = pending!;
    setPending(null);
    toast('Backup restored.');
    navigate(restored.data.onboardingComplete ? 'home' : 'onboarding');
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPending(readBackup(await file.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "This file couldn't be read.");
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const restore = () => {
    if (!pending) return;
    void replace.start((current) => ({ ok: true, data: { ...pending.data, revision: current.revision } }), 'replace');
  };
  const close = () => replace.cancel() && setPending(null);

  return (
    <>
      <button type="button" className="button small link" onClick={() => input.current?.click()}>
        <Icon icon={Upload} size={16} /> {label}
      </button>
      <input ref={input} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="Backup file" onChange={(e) => void onFile(e.target.files?.[0])} />
      {pending && (
        <Modal title="Restore this backup?" onClose={close}>
          <div className="stack">
            <p>
              This backup has {pending.itemCount === 1 ? '1 item' : `${pending.itemCount} items`}
              {pending.exportedAt ? `, saved ${formatMedium(todayLocal(new Date(pending.exportedAt)))}` : ''}.
            </p>
            <p>Restoring replaces everything currently in the app with the backup.</p>
            <KeepACopy />
            {replace.failure && (
              <p className="form-error" role="alert">
                Couldn't restore your backup. {replace.failure.error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={close} disabled={replace.busy} data-autofocus>
                Cancel
              </button>
              {replace.failure && !replace.failure.canRetry ? null : (
                <button type="button" className="button primary" onClick={replace.failure ? () => void replace.retry() : restore} disabled={replace.busy}>
                  {replace.busy ? 'Restoring…' : replace.failure ? 'Try again' : 'Replace with backup'}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
      {error && (
        <Modal title="Couldn't restore" onClose={() => setError(null)}>
          <div className="stack">
            <p className="form-error">
              <Icon icon={AlertCircle} size={16} /> {error}
            </p>
            <div className="form-actions">
              <button type="button" className="button primary" onClick={() => setError(null)} data-autofocus>
                OK
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Start over: erase everything entered and go back to setup, after an
 * explicit confirmation that offers a backup first. Cancel changes nothing.
 */
export function StartOverButton() {
  const { data } = useStore();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const count = countItems(data);
  const replace = useReplace(() => {
    setConfirming(false);
    toast("Your data was erased. Set up again whenever you're ready.");
    navigate('onboarding');
  });
  const erase = () => void replace.start((d) => ops.startOver(d), 'reset');
  const close = () => replace.cancel() && setConfirming(false);
  return (
    <>
      <button type="button" className="button small danger-link" onClick={() => setConfirming(true)}>
        Start over
      </button>
      {confirming && (
        <Modal title="Start over?" onClose={close}>
          <div className="stack">
            <p>
              This erases {count === 0 ? 'your setup' : `all ${itemsText(count)} you've entered, with everything recorded for them,`} and takes you back to setup.
            </p>
            <KeepACopy />
            {replace.failure && (
              <p className="form-error" role="alert">
                Couldn't erase your data. {replace.failure.error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={close} disabled={replace.busy} data-autofocus>
                Cancel
              </button>
              {replace.failure && !replace.failure.canRetry ? null : (
                <button type="button" className="button danger" onClick={replace.failure ? () => void replace.retry() : erase} disabled={replace.busy}>
                  {replace.busy ? 'Erasing…' : replace.failure ? 'Try again' : 'Erase and start over'}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Shown only when a save failed or newer data exists elsewhere. */
export function SaveStatusBar() {
  const { saveStatus, saveMessage, retrySave, reload } = useStore();
  if (saveStatus !== 'error' && saveStatus !== 'conflict') return null;
  return (
    <div className="save-status" role="alert">
      <Icon icon={AlertCircle} size={20} />
      <p>{saveStatus === 'error' ? `Your latest change hasn't been saved. ${saveMessage ?? ''}` : saveMessage}</p>
      {saveStatus === 'error' ? (
        <button type="button" className="button small secondary" onClick={retrySave}>
          <Icon icon={RefreshCw} size={16} /> Try again
        </button>
      ) : (
        <button type="button" className="button small secondary" onClick={reload}>
          <Icon icon={RefreshCw} size={16} /> Reload
        </button>
      )}
    </div>
  );
}
