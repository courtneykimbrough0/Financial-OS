/**
 * Changes one account hadn't saved when another account signed in on this
 * device (in another tab). They belong to the first account, so they're shown
 * and used only after that account's password is entered: a separate,
 * in-memory session checks it without touching the browser's session. Then
 * they can be saved into that account, but only on top of exactly the
 * revision they were made from, so newer data is never written over; or
 * downloaded as a backup. Discarding takes a second, explicit step. Nothing
 * here marks them saved unless the server confirms it.
 *
 * A restore or start over that was waiting for the server's answer may or may
 * not have been applied. Unlocked, the panel checks that account: applied
 * (its plan is the restored or erased one), not applied (still exactly the
 * revision it started from: the person can finish it, as that account), or
 * changed since (left alone). It's never sent again by itself.
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

/** What the panel says, by what was waiting: ordinary changes, a restore, or a start over. */
function copyFor(item: SetAside) {
  const who = item.owner.email ?? 'a temporary identity';
  if (item.intent === 'replace') {
    return {
      intro: `A restore of a backup for ${who} was waiting for the server’s answer when another account signed in on this device. It may or may not have been applied.`,
      action: `Check and finish the restore in ${who}’s account`,
      already: `The restore was applied to ${who}’s account.`,
      saved: `Restored in ${who}’s account.`,
      stale: `${who}’s plan changed since, so the restore wasn’t applied over it. Download the backup to compare.`,
      download: 'Download the backup',
    };
  }
  if (item.intent === 'reset') {
    return {
      intro: `Starting over (erasing the plan) for ${who} was waiting for the server’s answer when another account signed in on this device. It may or may not have been applied.`,
      action: `Check and finish starting over in ${who}’s account`,
      already: `${who}’s plan was erased: starting over was applied.`,
      saved: `${who}’s plan was erased.`,
      stale: `${who}’s plan changed since, so it wasn’t erased.`,
      download: null,
    };
  }
  return {
    intro: null,
    action: `Save them to ${who}’s account`,
    already: `These changes are already saved in ${who}’s account.`,
    saved: `Saved to ${who}’s account.`,
    stale: `${who}’s plan changed since these edits, so they weren’t saved over it. Download them to compare.`,
    download: 'Download them',
  };
}

export function RecoveryPanel({ item, verifier, onSaved, onDone }: { item: SetAside; verifier: () => SupabaseClient; onSaved: () => void; onDone: () => void }) {
  const email = item.owner.email;
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState<SupabaseClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [discarding, setDiscarding] = useState(false);
  const verifierClient = useRef<SupabaseClient | null>(null);
  const copy = copyFor(item);

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
        setOutcome({ kind: 'already', message: copy.already });
        return;
      }
      if (!current || current.revision !== item.baseRevision) return setError(copy.stale);
      // Exactly the revision it started from: send it now, as that account, with its own intent.
      const { error: err } = await unlocked.rpc('save_plan', { p_base_revision: item.baseRevision, p_save_id: crypto.randomUUID(), p_mode: item.intent, p_plan: toRows(item.data) });
      if (err) return setError(err.code === 'PT409' ? copy.stale : `That wasn’t saved: ${err.message}`);
      setOutcome({ kind: 'saved', message: copy.saved });
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
            <Icon icon={AlertCircle} size={16} />{' '}
            {copy.intro ?? (
              <>
                Changes made as <strong>{email ?? 'a temporary identity'}</strong> weren’t saved: another account signed in on this device.
              </>
            )}{' '}
            They’re kept here, not in any account, until this page closes.
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
                  {busy ? 'Checking…' : copy.action}
                </button>
              )}
              {copy.download && (
                <button type="button" className="button small secondary" onClick={download}>
                  <Icon icon={Download} size={16} /> {copy.download}
                </button>
              )}
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
