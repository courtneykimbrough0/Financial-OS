import { AlertCircle, Download, RefreshCw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatMedium, todayLocal } from '../../domain/dates';
import { createBackup, readBackup, type ParsedBackup } from '../../state/backup';
import { useStore } from '../../state/store';
import { navigate } from '../router';
import { Icon, Modal, useToast } from './common';

function downloadFile(filename: string, text: string) {
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
