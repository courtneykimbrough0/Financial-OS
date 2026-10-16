import { AlertCircle, Download, RefreshCw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatMedium, todayLocal } from '../../domain/dates';
import * as ops from '../../domain/operations';
import { countItems, createBackup, readBackup, type ParsedBackup } from '../../state/backup';
import { useStore } from '../../state/store';
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

/** Pick a backup file, confirm, then replace the app's data with it. */
export function RestoreBackupButton({ label = 'Restore from backup' }: { label?: string }) {
  const { run } = useStore();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPending(readBackup(await file.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This file couldn’t be read.');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const restore = () => {
    if (!pending) return;
    const result = run((current) => ({ ok: true, data: { ...pending.data, revision: current.revision } }));
    setPending(null);
    if (!result.ok) return setError(result.error);
    toast('Backup restored.');
    navigate(pending.data.onboardingComplete ? 'dashboard' : 'onboarding');
  };

  return (
    <>
      <button type="button" className="button small link" onClick={() => input.current?.click()}>
        <Icon icon={Upload} size={16} /> {label}
      </button>
      <input ref={input} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-label="Backup file" onChange={(e) => void onFile(e.target.files?.[0])} />
      {pending && (
        <Modal title="Restore this backup?" onClose={() => setPending(null)}>
          <div className="stack">
            <p>
              This backup has {pending.itemCount === 1 ? '1 item' : `${pending.itemCount} items`}
              {pending.exportedAt ? `, saved ${formatMedium(todayLocal(new Date(pending.exportedAt)))}` : ''}.
            </p>
            <p>Restoring replaces everything currently in the app with the backup.</p>
            <KeepACopy />
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setPending(null)} data-autofocus>
                Cancel
              </button>
              <button type="button" className="button primary" onClick={restore}>
                Replace with backup
              </button>
            </div>
          </div>
        </Modal>
      )}
      {error && (
        <Modal title="Couldn’t restore" onClose={() => setError(null)}>
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
  const { data, run } = useStore();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = countItems(data);
  const erase = () => {
    const r = run((d) => ops.startOver(d));
    if (!r.ok) return setError(r.error);
    setConfirming(false);
    toast('Your data was erased. Set up again whenever you’re ready.');
    navigate('onboarding');
  };
  return (
    <>
      <button type="button" className="button small danger-link" onClick={() => setConfirming(true)}>
        Start over
      </button>
      {confirming && (
        <Modal title="Start over?" onClose={() => setConfirming(false)}>
          <div className="stack">
            <p>
              This erases {count === 0 ? 'your setup' : `all ${itemsText(count)} you’ve entered, with everything recorded for them,`} and takes you back to setup. Your review rhythm stays.
            </p>
            <KeepACopy />
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setConfirming(false)} data-autofocus>
                Cancel
              </button>
              <button type="button" className="button danger" onClick={erase}>
                Erase and start over
              </button>
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
      <p>{saveStatus === 'error' ? `Your latest change hasn’t been saved. ${saveMessage ?? ''}` : saveMessage}</p>
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
