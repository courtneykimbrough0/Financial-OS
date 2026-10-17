/**
 * Changes one account hadn't saved when another account signed in on this
 * device (in another tab). They belong to the first account, so they're shown
 * and used only after that account's password is entered: a separate,
 * in-memory session checks it without touching the browser's session. Then
 * they can be saved into that account, but only on top of exactly the
 * revision they were made from, so newer data is never written over; or
 * downloaded as a backup. Discarding takes a second, explicit step. Nothing
 * here marks them saved unless the server confirms it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AlertCircle, Download } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AppData } from '../../domain/types';
import { createBackup } from '../../state/backup';
import { canonicalize, fromRows, toRows, type LoadedPlan } from '../../state/supabase/rows';
import { authMessage, type SetAside } from '../../state/supabase/session';
import { downloadFile } from '../components/backup';
import { Field, FormError, Icon } from '../components/common';

const samePlan = (a: AppData, b: AppData) => JSON.stringify(canonicalize({ ...a, revision: 0 })) === JSON.stringify(canonicalize({ ...b, revision: 0 }));

type Outcome = { kind: 'saved' | 'already'; message: string } | null;

export function RecoveryPanel({ item, verifier, onSaved, onDone }: { item: SetAside; verifier: () => SupabaseClient; onSaved: () => void; onDone: () => void }) {
  const email = item.owner.email;
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState<SupabaseClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [discarding, setDiscarding] = useState(false);
  const verifierClient = useRef<SupabaseClient | null>(null);

  // The separate session ends with the panel.
  useEffect(() => () => void verifierClient.current?.auth.signOut({ scope: 'local' }).catch(() => undefined), []);

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !email || !password) return;
    setBusy(true);
    setError(null);
    const c = verifierClient.current ?? verifier();
    verifierClient.current = c;
    const { data, error: err } = await c.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) return setError(err.code === 'invalid_credentials' ? 'That password isn’t right.' : authMessage(err));
    if (data.user.id !== item.owner.id) return setError('That’s a different account.');
    setPassword('');
    setUnlocked(c);
  };

  const save = async () => {
    if (!unlocked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const loaded = await unlocked.rpc('load_plan');
      if (loaded.error) return setError(`They weren’t saved: ${loaded.error.message}`);
      const current = loaded.data ? fromRows(loaded.data as LoadedPlan) : null;
      if (current && samePlan(current, item.data)) {
        setOutcome({ kind: 'already', message: `These changes are already saved in ${email}’s account.` });
        return;
      }
      if (!current || current.revision !== item.baseRevision) {
        return setError(`${email}’s plan changed since these edits, so they weren’t saved over it. Download them to compare.`);
      }
      const { error: err } = await unlocked.rpc('save_plan', { p_base_revision: item.baseRevision, p_save_id: crypto.randomUUID(), p_mode: 'update', p_plan: toRows(item.data) });
      if (err) {
        return setError(err.code === 'PT409' ? `${email}’s plan changed since these edits, so they weren’t saved over it. Download them to compare.` : `They weren’t saved: ${err.message}`);
      }
      setOutcome({ kind: 'saved', message: `Saved to ${email}’s account.` });
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const { filename, text } = createBackup(item.data, new Date(item.at));
    downloadFile(filename.replace('backup', 'unsaved-changes'), text);
  };

  return (
    <section className="card recovery-panel stack-sm" role="region" aria-label="Unsaved changes from another account">
      {outcome ? (
        <>
          <p role="status">{outcome.message}</p>
          <button type="button" className="button small secondary" onClick={onDone}>
            Done
          </button>
        </>
      ) : (
        <>
          <p>
            <Icon icon={AlertCircle} size={16} /> Changes made as <strong>{email ?? 'a temporary identity'}</strong> weren’t saved: another account signed in on this device. They’re kept here, not in any account, until this page closes.
          </p>
          {!unlocked && email && (
            <form className="stack-sm" onSubmit={(e) => void unlock(e)} noValidate aria-label="Unlock the unsaved changes">
              <Field label={`Password for ${email}`}>{(p) => <input {...p} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
              <button type="submit" className="button small primary" disabled={busy || !password}>
                {busy ? 'Checking…' : 'Unlock'}
              </button>
            </form>
          )}
          {(unlocked || !email) && (
            <div className="settings-actions">
              {unlocked && (
                <button type="button" className="button small primary" onClick={() => void save()} disabled={busy}>
                  {busy ? 'Saving…' : `Save them to ${email}’s account`}
                </button>
              )}
              <button type="button" className="button small secondary" onClick={download}>
                <Icon icon={Download} size={16} /> Download them
              </button>
            </div>
          )}
          <FormError message={error} />
          {discarding ? (
            <div className="settings-actions" role="group" aria-label="Discard the unsaved changes?">
              <button type="button" className="button small secondary" onClick={() => setDiscarding(false)}>
                Keep them
              </button>
              <button type="button" className="button small danger" onClick={onDone}>
                Discard for good
              </button>
            </div>
          ) : (
            <button type="button" className="button small danger-link" onClick={() => setDiscarding(true)}>
              Discard them
            </button>
          )}
        </>
      )}
    </section>
  );
}
