import { useId, useMemo, useState } from 'react';
import { formatMedium, formatRange, formatShort, type DateStr } from '../../domain/dates';
import type { GapExplanation } from '../../domain/forecast';
import { formatMoney, parseMoney } from '../../domain/money';
import { findOccurrence } from '../../domain/occurrences';
import { applyPreviewedChange, previewChange, type ChangePreview, type ProposedChange } from '../../domain/preview';
import { LIABILITY_TYPE_LABEL, type AppData, type Occurrence } from '../../domain/types';
import { useStore } from '../../state/store';
import { Field, FormError, KindAvatar, Modal, MoneyInput, useToast } from './common';

type Kind = ProposedChange['kind'];
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'move', label: 'Move date' },
  { kind: 'amount', label: 'Change amount' },
  { kind: 'skip', label: 'Skip this one' },
];

/**
 * "What if…" for one outstanding transaction: move it, change its amount, or
 * leave it out, and see the forecast next to the current one. The preview is
 * calculated by `previewChange` on a copy; nothing is saved unless the person
 * confirms Apply, and then only this one occurrence changes.
 */
export function WhatIfSheet({ occurrenceId, through, onBack, onDone }: { occurrenceId: string; through?: DateStr; onBack: () => void; onDone: () => void }) {
  const { data, today, run } = useStore();
  const toast = useToast();
  const o = findOccurrence(data, occurrenceId, today);
  const [kind, setKind] = useState<Kind>('move');
  const [date, setDate] = useState<DateStr>(o && o.scheduledDate > today ? o.scheduledDate : today);
  const [amount, setAmount] = useState(o ? (o.scheduledAmountCents / 100).toFixed(2) : '');
  const [confirming, setConfirming] = useState<{ change: ProposedChange; previewedOn: AppData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pillsId = useId();

  const change = useMemo((): ProposedChange | null => {
    if (kind === 'skip') return { kind, occurrenceId };
    if (kind === 'move') return date ? { kind, occurrenceId, date } : null;
    const cents = parseMoney(amount);
    return cents === null ? null : { kind, occurrenceId, amountCents: cents };
  }, [kind, date, amount, occurrenceId]);
  const result = useMemo(() => (change ? previewChange(data, change, { today, now: `${today}T00:00:00.000Z` }, { through }) : null), [data, change, today, through]);

  if (!o || o.status !== 'scheduled') {
    return (
      <Modal title="What if…" onClose={onBack}>
        <p>This transaction has already been recorded or changed, so it can’t be previewed here.</p>
      </Modal>
    );
  }

  const apply = () => {
    if (!confirming) return;
    const r = run((d, clock) => applyPreviewedChange(d, confirming.previewedOn, confirming.change, clock));
    if (!r.ok) {
      setConfirming(null);
      return setError(r.error);
    }
    toast(describeChange(o.description, confirming.change, o.scheduledDate, true));
    onDone();
  };

  return (
    <Modal title="What if…" onClose={onBack}>
      <div className="stack whatif">
        <div className="occ-summary">
          <KindAvatar kind={o.kind} />
          <div className="occ-summary-main">
            <strong>{o.description}</strong>
            <p className="muted">
              Expected {o.kind === 'income' ? '+' : '−'}
              {formatMoney(o.scheduledAmountCents)} on {formatMedium(o.scheduledDate)}
            </p>
          </div>
        </div>

        {confirming ? (
          <div className="stack-sm" role="group" aria-labelledby={`${pillsId}-confirm`}>
            <h3 id={`${pillsId}-confirm`}>Apply this change?</h3>
            <p>{describeChange(o.description, confirming.change, o.scheduledDate, false)}</p>
            {confirming.change.kind === 'skip' && <p className="callout callout-info">{skipNote(o, data)}</p>}
            <p className="hint">
              {o.sourceId ? `Only this one on ${formatMedium(o.scheduledDate)} changes; later ones keep their schedule. ` : ''}
              This updates your Financial OS forecast. It doesn’t change any payment arrangement outside the app.
            </p>
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={() => setConfirming(null)} data-autofocus>
                Keep exploring
              </button>
              <button type="button" className="button primary" onClick={apply}>
                Apply change
              </button>
            </div>
          </div>
        ) : (
          <>
            <fieldset className="choice-field">
              <legend className="sr-only">What to change</legend>
              <div className="choice-pills">
                {KINDS.map((k) => (
                  <label key={k.kind} className={`choice-pill${kind === k.kind ? ' selected' : ''}`}>
                    <input type="radio" name={`${pillsId}-kind`} value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} />
                    {k.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {kind === 'move' && (
              <Field label="New date">{(p) => <input {...p} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            )}
            {kind === 'amount' && <Field label="New amount">{(p) => <MoneyInput {...p} value={amount} onChange={setAmount} />}</Field>}
            {kind === 'skip' && <p className="hint">{skipNote(o, data)}</p>}

            <section aria-live="polite" aria-label="Preview">
              {result && !result.ok && <p className="field-error">{result.error}</p>}
              {result && result.ok && change && (
                <>
                  <p className="hint whatif-change">{describeChange(o.description, change, o.scheduledDate, false)}</p>
                  <PreviewResult p={result.preview} />
                </>
              )}
            </section>
            <FormError message={error} />

            <div className="form-actions">
              <button type="button" className="button secondary" onClick={onBack}>
                Back
              </button>
              {result?.ok && result.preview.comparable && change && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    setError(null);
                    setConfirming({ change, previewedOn: data });
                  }}
                >
                  Apply change…
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** What skipping means for this kind of item: only the forecast changes. */
function skipNote(o: Occurrence, data: AppData): string {
  if (o.kind === 'income') return 'Shows your forecast without this income. It doesn’t change what you’re owed.';
  if (o.kind === 'liability') {
    const type = data.sources.find((s) => s.id === o.sourceId)?.liabilityType;
    const what = type ? LIABILITY_TYPE_LABEL[type].toLowerCase() : 'debt';
    return `Shows your forecast without this payment. Your ${what} and the payment you owe don’t change; Financial OS just leaves this one out.`;
  }
  return 'Shows your forecast without this payment. It doesn’t cancel, waive, or pay it.';
}

function describeChange(name: string, change: ProposedChange, from: DateStr, done: boolean): string {
  if (change.kind === 'move') return done ? `Moved ${name} to ${formatMedium(change.date)}.` : `Move ${name} from ${formatMedium(from)} to ${formatMedium(change.date)}.`;
  if (change.kind === 'amount') return done ? `${name} now expected ${formatMoney(change.amountCents)}.` : `Expect ${formatMoney(change.amountCents)} for ${name} on ${formatMedium(from)}.`;
  return done ? `Left ${name} on ${formatMedium(from)} out of your forecast.` : `Leave ${name} on ${formatMedium(from)} out of your forecast.`;
}

const gapLine = (g: GapExplanation) => `${formatRange(g.start, g.end)}, down to ${formatMoney(g.lowestCents)}`;

function PreviewResult({ p }: { p: ChangePreview }) {
  if (!p.comparable) {
    const text =
      p.reason === 'anchor-changed'
        ? `This changes your next payday from ${formatMedium(p.current.forecastStart!)} to ${formatMedium(p.proposed.forecastStart!)}. The running total starts the day before payday, so the two forecasts would start on different days and can’t be compared directly.`
        : p.reason === 'before-payday'
          ? `The new date is before your next payday (${formatMedium(p.current.forecastStart!)}), when the running total starts, so the payment would just drop out of it. The forecast can’t show whether money on hand covers it.`
          : 'There’s no upcoming payday to start a running total from, so this can’t be compared.';
    return <p className="callout callout-info">{text}</p>;
  }
  const cur = p.current.lowest;
  const next = p.proposed.lowest;
  const t = p.target;
  const deeperThan = (g: GapExplanation) => p.current.gaps.find((c) => c.start <= g.end && g.start <= c.end);
  return (
    <div className="stack-sm whatif-result">
      {cur && next && (
        <p className="whatif-headline">
          {next.tallyCents > cur.tallyCents
            ? `Your lowest running total would improve from ${formatMoney(cur.tallyCents)} to ${formatMoney(next.tallyCents)}.`
            : next.tallyCents < cur.tallyCents
              ? `Your lowest running total would drop from ${formatMoney(cur.tallyCents)} to ${formatMoney(next.tallyCents)}.`
              : `Your lowest running total would stay at ${formatMoney(cur.tallyCents)}.`}
        </p>
      )}
      <dl className="sheet-stats whatif-compare">
        <div>
          <dt>Now</dt>
          <dd>{cur ? `${formatMoney(cur.tallyCents)} on ${formatShort(cur.date)}` : '—'}</dd>
        </div>
        <div>
          <dt>With this change</dt>
          <dd>{next ? `${formatMoney(next.tallyCents)} on ${formatShort(next.date)}` : '—'}</dd>
        </div>
      </dl>
      {t && (
        <p className={`callout ${t.outcome === 'eliminated' || t.outcome === 'reduced' ? 'callout-ok' : 'callout-warn'}`}>
          {t.outcome === 'eliminated'
            ? `The timing gap ${formatRange(t.gap.start, t.gap.end)} would be gone.`
            : t.outcome === 'reduced'
              ? `The timing gap ${formatRange(t.gap.start, t.gap.end)} would be smaller: ${t.proposedGaps.map(gapLine).join('; ')}.`
              : t.outcome === 'worsened'
                ? `The timing gap ${formatRange(t.gap.start, t.gap.end)} would be worse: ${t.proposedGaps.map(gapLine).join('; ')}.`
                : `The timing gap ${formatRange(t.gap.start, t.gap.end)} would stay the same.`}
          {t.recoversOn.proposed && t.recoversOn.current && t.recoversOn.proposed !== t.recoversOn.current
            ? ` Back to $0 or more on ${formatShort(t.recoversOn.proposed)} instead of ${formatShort(t.recoversOn.current)}.`
            : ''}
        </p>
      )}
      {p.newGaps.map((g) => (
        <p key={`new-${g.start}`} className="callout callout-warn">
          New timing gap: {gapLine(g)}
          {g.recoversOn ? `, back to $0 or more on ${formatShort(g.recoversOn)}` : ''}.
        </p>
      ))}
      {p.worsenedGaps.map((g) => (
        <p key={`worse-${g.start}`} className="callout callout-warn">
          Deeper timing gap: {gapLine(g)} (now {formatMoney(deeperThan(g)?.lowestCents ?? g.lowestCents)}).
        </p>
      ))}
      {!t && p.newGaps.length === 0 && p.worsenedGaps.length === 0 && (
        <p className="hint">{p.proposed.gaps.length === 0 ? 'No timing gaps either way.' : 'Your timing gaps stay as they are.'}</p>
      )}
    </div>
  );
}
