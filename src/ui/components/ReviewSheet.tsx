import { ChevronRight, Undo2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { formatMedium, type DateStr } from '../../domain/dates';
import { formatMoney } from '../../domain/money';
import { reviewEntries, type Forecast, type ForecastEntry } from '../../domain/forecast';
import * as ops from '../../domain/operations';
import type { AppData } from '../../domain/types';
import { useStore } from '../../state/store';
import { Field, FlowAmount, FormError, Icon, KindAvatar, Modal, SectionLabel, useToast } from './common';

/** The last batch, kept so it can be undone as one step. */
interface Batch {
  before: AppData;
  ids: string[];
  message: string;
}

const items = (n: number) => (n === 1 ? '1 item' : `${n} items`);

/**
 * Review what needs an update: overdue and due-today items first, then the rest
 * of this week. Select several and mark them done as expected, or move them to
 * a new date, in one step that can be undone. Tap an item to record a
 * different amount or date for just that one.
 */
export function ReviewSheet({ forecast, title, onOpen, onClose }: { forecast: Forecast; title: string; onOpen: (id: string) => void; onClose: () => void }) {
  const { run, today } = useStore();
  const toast = useToast();
  const { attention, upcoming } = reviewEntries(forecast);
  const visible = new Set([...attention, ...upcoming].map((e) => e.occurrence.id));
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const selected = [...picked].filter((id) => visible.has(id));
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState<DateStr>(today);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const submitting = useRef(false);

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setGroup = (entries: ForecastEntry[], on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      for (const e of entries) {
        if (on) next.add(e.occurrence.id);
        else next.delete(e.occurrence.id);
      }
      return next;
    });

  const applyBatch = (op: (d: AppData, clock: ops.Clock) => ops.Result, message: string) => {
    if (submitting.current) return;
    submitting.current = true;
    let before: AppData | null = null;
    const ids = selected;
    const result = run((d, clock) => {
      before = d;
      return op(d, clock);
    });
    submitting.current = false;
    if (!result.ok) return setError(result.error);
    setError(null);
    setPicked(new Set());
    setMoving(false);
    setBatch({ before: before!, ids, message });
    toast(message);
  };

  const markDone = () => applyBatch((d, c) => ops.recordAsExpected(d, selected, c), `Marked ${items(selected.length)} done as expected.`);
  const move = (e: FormEvent) => {
    e.preventDefault();
    if (!moveDate) return setError('Choose a date.');
    applyBatch((d, c) => ops.rescheduleSelected(d, selected, moveDate, c), `Moved ${items(selected.length)} to ${formatMedium(moveDate)}.`);
  };
  const undo = () => {
    if (!batch) return;
    const result = run((d) => ops.undoBatch(d, batch.before, batch.ids));
    if (!result.ok) return setError(result.error);
    setBatch(null);
    toast(`Undone: ${items(batch.ids.length)} back to how they were.`);
  };

  const empty = attention.length === 0 && upcoming.length === 0;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack review">
        {batch && (
          <div className="callout callout-ok review-undo" role="status">
            <span>{batch.message}</span>
            <button type="button" className="button small secondary" onClick={undo}>
              <Icon icon={Undo2} size={16} /> Undo
            </button>
          </div>
        )}
        {empty ? (
          <p className="muted">Nothing to review through Saturday. Everything due so far has been recorded.</p>
        ) : (
          <p className="muted">Select what went as expected and mark it done in one step, or tap an item to record a different amount or date.</p>
        )}
        <ReviewGroup label="Needs an update" hint="Due today or earlier. These stay in your forecast until you record them." entries={attention} picked={picked} onToggle={toggle} onGroup={setGroup} onOpen={onOpen} today={today} />
        <ReviewGroup label="Later this week" entries={upcoming} picked={picked} onToggle={toggle} onGroup={setGroup} onOpen={onOpen} today={today} />

        {selected.length > 0 && !moving && (
          <div className="review-actions">
            <button type="button" className="button primary" onClick={markDone}>
              Mark {items(selected.length)} done
            </button>
            <button type="button" className="button secondary" onClick={() => setMoving(true)}>
              Move to a date
            </button>
            <p className="hint">Done uses each item’s expected amount and date (today, for items not yet due). Each original prediction is kept.</p>
          </div>
        )}
        {selected.length > 0 && moving && (
          <form className="stack review-actions" onSubmit={move} noValidate>
            <Field label={`New expected date for ${items(selected.length)}`} hint="Amounts stay the same. Only the selected items move.">
              {(p) => <input {...p} type="date" min={today} value={moveDate} onChange={(e) => setMoveDate(e.target.value)} autoFocus />}
            </Field>
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setMoving(false)}>
                Back
              </button>
              <button type="submit" className="button primary">
                Move
              </button>
            </div>
          </form>
        )}
        <FormError message={error} />
      </div>
    </Modal>
  );
}

function ReviewGroup({
  label,
  hint,
  entries,
  picked,
  onToggle,
  onGroup,
  onOpen,
  today,
}: {
  label: string;
  hint?: string;
  entries: ForecastEntry[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  onGroup: (entries: ForecastEntry[], on: boolean) => void;
  onOpen: (id: string) => void;
  today: DateStr;
}) {
  if (entries.length === 0) return null;
  const all = entries.every((e) => picked.has(e.occurrence.id));
  return (
    <section className="stack-sm" aria-label={label}>
      <SectionLabel
        action={
          <button type="button" className="button link small" onClick={() => onGroup(entries, !all)}>
            {all ? 'Clear' : 'Select all'}
          </button>
        }
      >
        {label}
      </SectionLabel>
      {hint && <p className="hint">{hint}</p>}
      <ul className="entry-list review-list">
        {entries.map((e) => {
          const o = e.occurrence;
          const when = o.scheduledDate < today ? `Overdue since ${formatMedium(o.scheduledDate)}` : o.scheduledDate === today ? 'Due today' : `Due ${formatMedium(o.scheduledDate)}`;
          return (
            <li key={o.id} className="review-row">
              <label className="review-check">
                <input
                  type="checkbox"
                  checked={picked.has(o.id)}
                  onChange={() => onToggle(o.id)}
                  aria-label={`Select ${o.description}, ${formatMoney(o.scheduledAmountCents)}, ${when[0]!.toLowerCase()}${when.slice(1)}`}
                />
              </label>
              <button type="button" className="entry" onClick={() => onOpen(o.id)}>
                <KindAvatar kind={o.kind} />
                <span className="entry-main">
                  <span className="entry-title">{o.description}</span>
                  <span className="entry-sub">{when}</span>
                </span>
                <span className="entry-side">
                  <FlowAmount kind={o.kind} cents={o.scheduledAmountCents} />
                  <Icon icon={ChevronRight} size={18} className="chevron" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
