import { AlertCircle } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { diffDays, formatLong, formatMedium, type DateStr } from '../../domain/dates';
import { centsToInput, formatMoney, formatSignedMoney, parseMoney } from '../../domain/money';
import { findOccurrence } from '../../domain/occurrences';
import * as ops from '../../domain/operations';
import { doneVerb as kindDoneVerb, KIND_LABEL, type Occurrence, type TransactionKind } from '../../domain/types';
import { useStore } from '../../state/store';
import { navigate, type Route } from '../router';
import { Field, FlowAmount, FormError, Icon, KindAvatar, Modal, MoneyInput, StatusBadge, useToast } from './common';

/** The screen where a recurring item's schedule is edited. */
const SOURCE_ROUTE: Record<TransactionKind, Route> = { income: 'plan/income', bill: 'plan/expenses', subscription: 'plan/expenses', liability: 'plan/liabilities', reserve: 'plan/reserves', varied: 'plan/expenses' };

type Mode = 'view' | 'record' | 'correct' | 'reschedule' | 'cancel' | 'delete';

const doneVerb = (o: Occurrence) => kindDoneVerb(o);

/** What a one-time item is, in words: "one-time income", "varied spending", "Strategic Reserve amount", "use of reserves". */
function oneTimeName(o: Occurrence): string {
  if (o.kind === 'varied') return 'varied spending';
  if (o.kind === 'reserve') return o.release ? 'use of reserves' : 'Strategic Reserve amount';
  return `one-time ${KIND_LABEL[o.kind].toLowerCase()}`;
}

/** "1 day late", "2 days early", "on time" */
function timing(expected: DateStr, actual: DateStr): string {
  const d = diffDays(expected, actual);
  if (d === 0) return 'on the expected date';
  const n = Math.abs(d);
  return `${n} day${n === 1 ? '' : 's'} ${d > 0 ? 'late' : 'early'}`;
}

function Comparison({ o }: { o: Occurrence }) {
  const rows: [string, string][] = [[`Originally expected`, `${formatMoney(o.expectedAmountCents)} on ${formatMedium(o.expectedDate)}`]];
  if (o.scheduledDate !== o.expectedDate || o.scheduledAmountCents !== o.expectedAmountCents) {
    rows.push(['Updated expectation', `${formatMoney(o.scheduledAmountCents)} on ${formatMedium(o.scheduledDate)}`]);
  }
  if (o.status === 'completed' && o.actualAmountCents !== null && o.actualDate !== null) {
    const diff = o.actualAmountCents - o.expectedAmountCents;
    rows.push([`Actually ${doneVerb(o)}`, `${formatMoney(o.actualAmountCents)} on ${formatMedium(o.actualDate)}`]);
    rows.push(['Difference', `${diff === 0 ? 'Same amount' : `${formatSignedMoney(diff)} vs. expected`}, ${timing(o.expectedDate, o.actualDate)}`]);
  }
  if (o.status === 'canceled') rows.push(['Canceled', o.cancelNote ? `Note: ${o.cancelNote}` : 'Not expected to happen']);
  return (
    <dl className="details">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OccurrenceSheet({ occurrenceId, onClose }: { occurrenceId: string; onClose: () => void }) {
  const { data, today, run } = useStore();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('view');
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<DateStr>(today);
  const [note, setNote] = useState('');
  const submitting = useRef(false);

  const o = findOccurrence(data, occurrenceId, today);
  if (!o) {
    return (
      <Modal title="Transaction" onClose={onClose}>
        <p>This transaction no longer exists.</p>
      </Modal>
    );
  }

  const open = (next: Mode) => {
    setError(null);
    if (next === 'record') {
      setAmount(centsToInput(o.scheduledAmountCents));
      setDate(ops.defaultActualDate(o.scheduledDate, today));
    } else if (next === 'correct') {
      setAmount(centsToInput(o.actualAmountCents ?? o.scheduledAmountCents));
      setDate(o.actualDate ?? today);
    } else if (next === 'reschedule') {
      setAmount(centsToInput(o.scheduledAmountCents));
      setDate(o.scheduledDate < today ? today : o.scheduledDate);
    } else if (next === 'cancel') {
      setNote('');
    }
    setMode(next);
  };

  const apply = (op: Parameters<typeof run>[0], message: string, closeAfter = true) => {
    // Guard against double submission before React re-renders.
    if (submitting.current) return;
    submitting.current = true;
    const result = run(op);
    submitting.current = false;
    if (!result.ok) return setError(result.error);
    toast(message);
    if (closeAfter) onClose();
    else setMode('view');
  };

  const submitAmountDate = (e: FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0) return setError('Enter an amount greater than $0.');
    if (!date) return setError('Choose a date.');
    if (mode === 'record') {
      apply((d, c) => ops.recordActual(d, o.id, { amountCents: cents, date }, c), `Recorded ${o.description}: ${formatMoney(cents)} ${doneVerb(o)} on ${formatMedium(date)}.`);
    } else if (mode === 'correct') {
      apply((d, c) => ops.correctActual(d, o.id, { amountCents: cents, date }, c), `Updated what was ${doneVerb(o)} for ${o.description}.`, false);
    } else if (mode === 'reschedule') {
      apply((d, c) => ops.rescheduleOccurrence(d, o.id, { date, amountCents: cents }, c), `${o.description} now expected ${formatMoney(cents)} on ${formatMedium(date)}.`);
    }
  };

  const title = o.description;
  const outstanding = o.status === 'scheduled';

  return (
    <Modal title={title} onClose={onClose}>
      <div className="occ-summary">
        <KindAvatar kind={o.kind} />
        <div className="occ-summary-main">
          <FlowAmount kind={o.kind} cents={o.status === 'completed' ? o.actualAmountCents! : o.scheduledAmountCents} strike={o.status === 'canceled'} release={o.release} />
          <p className="muted">
            {KIND_LABEL[o.kind]} · {o.sourceId ? 'Recurring' : 'One-time'}
          </p>
        </div>
        <StatusBadge status={o.displayStatus} kind={o.kind} />
      </div>
      <p className="occ-date">{formatLong(o.status === 'completed' ? o.actualDate! : o.scheduledDate)}</p>
      {o.displayStatus === 'overdue' && (
        <p className="callout callout-warn">
          <Icon icon={AlertCircle} size={16} /> 
          This was expected on {formatMedium(o.scheduledDate)} and hasn’t been marked {doneVerb(o)}. It stays in your forecast until you record what happened, change its date, or cancel it.
        </p>
      )}
      <Comparison o={o} />

      {mode === 'view' && (
        <div className="action-list">
          {outstanding && (
            <>
              <button type="button" className="button primary" onClick={() => open('record')} data-autofocus>
                Mark {doneVerb(o)}
              </button>
              <button type="button" className="button secondary" onClick={() => open('reschedule')}>
                {o.sourceId ? 'Change just this one' : 'Change date or amount'}
              </button>
              <button type="button" className="button secondary" onClick={() => open('cancel')}>
                Cancel this one
              </button>
            </>
          )}
          {o.status === 'completed' && (
            <>
              <button type="button" className="button secondary" onClick={() => open('correct')}>
                Fix what was {doneVerb(o)}
              </button>
              <button type="button" className="button secondary" onClick={() => apply((d, c) => ops.restoreOccurrence(d, o.id, c), `Marked ${o.description} as not ${doneVerb(o)} yet.`, false)}>
                Undo: not {doneVerb(o)} yet
              </button>
            </>
          )}
          {o.status === 'canceled' && (
            <button type="button" className="button secondary" onClick={() => apply((d, c) => ops.restoreOccurrence(d, o.id, c), `Restored ${o.description}.`, false)}>
              Restore to expected
            </button>
          )}
          {o.sourceId === null && (
            <button type="button" className="button danger-link" onClick={() => open('delete')}>
              Delete this {oneTimeName(o)}
            </button>
          )}
          {o.sourceId !== null && outstanding && (
            <>
              <button
                type="button"
                className="button link"
                onClick={() => {
                  onClose();
                  navigate(SOURCE_ROUTE[o.kind]);
                }}
              >
                Change this and later ones
              </button>
              <p className="hint">
                “Just this one” changes only the {formatMedium(o.scheduledDate)} occurrence. To change the amount or schedule from a date on, edit {o.description} on its screen.
              </p>
            </>
          )}
        </div>
      )}

      {(mode === 'record' || mode === 'correct' || mode === 'reschedule') && (
        <form className="stack" onSubmit={submitAmountDate} noValidate>
          <h3>{mode === 'record' ? `What was ${doneVerb(o)}?` : mode === 'correct' ? `Fix what was ${doneVerb(o)}` : 'New expected date or amount'}</h3>
          <Field label={mode === 'reschedule' ? 'Expected amount' : `Amount ${doneVerb(o)}`}>{(p) => <MoneyInput {...p} value={amount} onChange={setAmount} autoFocus />}</Field>
          <Field label={mode === 'reschedule' ? 'Expected date' : `Date ${doneVerb(o)}`} hint={mode === 'reschedule' ? 'The original prediction is kept for comparison.' : undefined}>
            {(p) =>
              mode === 'reschedule' ? (
                <input {...p} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
              ) : (
                <input {...p} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
              )
            }
          </Field>
          <FormError message={error} />
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setMode('view')}>
              Back
            </button>
            <button type="submit" className="button primary">
              {mode === 'record' ? `Save as ${doneVerb(o)}` : 'Save'}
            </button>
          </div>
        </form>
      )}

      {mode === 'cancel' && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            apply((d, c) => ops.cancelOccurrence(d, o.id, note, c), `Canceled ${o.description} on ${formatMedium(o.scheduledDate)}.`);
          }}
        >
          <h3>Cancel this occurrence?</h3>
          <p>It will be removed from your forecast but kept on record as canceled. {o.sourceId ? 'Future occurrences are not affected.' : ''}</p>
          <Field label="Note (optional)">{(p) => <input {...p} type="text" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />}</Field>
          <FormError message={error} />
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setMode('view')}>
              Keep it
            </button>
            <button type="submit" className="button danger">
              Cancel occurrence
            </button>
          </div>
        </form>
      )}

      {mode === 'delete' && (
        <div className="stack">
          <h3>Delete this {oneTimeName(o)}?</h3>
          <p>Use this if it was added by mistake. To keep a record that it didn’t happen, cancel it instead.</p>
          <FormError message={error} />
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setMode('view')} data-autofocus>
              Keep it
            </button>
            <button type="button" className="button danger" onClick={() => apply((d) => ops.deleteOneTime(d, o.id), `Deleted ${o.description}.`)}>
              Delete
            </button>
          </div>
        </div>
      )}
      {mode === 'view' && <FormError message={error} />}
    </Modal>
  );
}
