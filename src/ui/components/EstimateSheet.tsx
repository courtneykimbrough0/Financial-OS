import { Lightbulb } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatMedium, formatShort } from '../../domain/dates';
import { analyzeEstimate, approveEstimate, dismissEstimate, ESTIMATE_KINDS, previewEstimate, type EstimateObservation, type EstimatePreview, type EstimateSuggestion } from '../../domain/estimates';
import { formatMoney } from '../../domain/money';
import type { AppData, RecurringSource } from '../../domain/types';
import { useStore } from '../../state/store';
import { FormError, Icon, KindAvatar, Modal, SectionLabel, useToast } from './common';
import { GapChanges, Money } from './comparison';

/** The current estimate suggestion for a recurring bill, subscription or liability payment; null for any other item. */
export function useEstimateSuggestion(source: RecurringSource): EstimateSuggestion | null {
  const { data, today } = useStore();
  return useMemo(() => (ESTIMATE_KINDS.includes(source.kind) ? analyzeEstimate(data, source.id, today).suggestion : null), [data, today, source.id, source.kind]);
}

/** How the suggested amount was worked out, in everyday words. */
export function methodLabel(s: EstimateSuggestion): string {
  switch (s.pattern) {
    case 'steady':
      return 'Same amount each time';
    case 'rising':
      return 'Payments going up';
    case 'falling':
      return 'Payments going down';
    case 'variable':
      return 'Average of recent payments';
    case 'seasonal':
      return s.differenceCents > 0 ? 'Possible seasonal increase' : 'Possible seasonal decrease';
  }
}

const changeText = (s: EstimateSuggestion) => `${formatMoney(Math.abs(s.differenceCents))} ${s.differenceCents > 0 ? 'more' : 'less'}`;
const whenText = (s: EstimateSuggestion) => (s.scope === 'one-payment' ? `For the ${formatMedium(s.effectiveDate)} payment only` : `From ${formatMedium(s.effectiveDate)} on`);

/** The short line on an item's card, with the button that opens the suggestion. */
export function EstimateCallout({ suggestion, onOpen }: { suggestion: EstimateSuggestion; onOpen: () => void }) {
  const s = suggestion;
  return (
    <div className="callout callout-info estimate-callout">
      <Icon icon={Lightbulb} size={16} />
      <span>
        {s.pattern === 'seasonal' ? `${methodLabel(s)}: ` : 'Suggested estimate: '}
        <strong>{formatMoney(s.proposedCents)}</strong> instead of {formatMoney(s.currentCents)}
        {s.scope === 'one-payment' ? ` for ${formatShort(s.effectiveDate)}` : ` from ${formatShort(s.effectiveDate)}`}.
      </span>
      <button type="button" className="button small secondary" onClick={onOpen} aria-label={`Review the suggestion for ${s.description}`}>
        Review
      </button>
    </div>
  );
}

const EXCLUDED: Record<NonNullable<EstimateObservation['excluded']>, string> = {
  unusual: 'Left out: more than 25% from your typical payment',
  earlier: 'Not counted: older than the payments used',
  'other-month': 'Not counted: a different month',
};

/**
 * One item's estimate suggestion: what it is, the payments behind it, its
 * limits, a preview of the forecast with it, and Approve, Dismiss or Not now.
 * Viewing, previewing and Not now save nothing. Approve asks for
 * confirmation and is refused if the data changed since; Dismiss keeps the
 * estimate and hides the same suggestion (see `dismissEstimate`).
 */
export function EstimateSheet({ sourceId, onClose }: { sourceId: string; onClose: () => void }) {
  const { data, today, run } = useStore();
  const toast = useToast();
  const id = useId();
  const live = useMemo(() => analyzeEstimate(data, sourceId, today).suggestion, [data, sourceId, today]);
  const [confirming, setConfirming] = useState<EstimateSuggestion | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep keyboard focus in place when switching to and from the confirmation.
  const backRef = useRef<HTMLButtonElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const switched = useRef(false);
  useEffect(() => {
    if (!switched.current) return;
    (confirming ? backRef : approveRef).current?.focus();
  }, [confirming]);
  const s = confirming ?? live;
  const name = data.sources.find((x) => x.id === sourceId)?.description ?? 'This item';

  if (!s) {
    return (
      <Modal title={`Suggestion for ${name}`} onClose={onClose}>
        <div className="stack">
          <p>There's no suggestion for this item right now. Its estimate stays as it is.</p>
          <FormError message={error} />
        </div>
      </Modal>
    );
  }

  const approve = () => {
    if (!confirming) return;
    const r = run((d, c) => approveEstimate(d, confirming, c));
    if (!r.ok) {
      setConfirming(null);
      return setError(r.error);
    }
    toast(s.scope === 'one-payment' ? `${s.description} on ${formatMedium(s.effectiveDate)} is now expected at ${formatMoney(s.proposedCents)}.` : `${s.description} is now expected at ${formatMoney(s.proposedCents)} from ${formatMedium(s.effectiveDate)}.`);
    onClose();
  };
  const dismiss = () => {
    const r = run((d, c) => dismissEstimate(d, s, c));
    if (!r.ok) return setError(r.error);
    toast(`Suggestion dismissed. ${s.description} stays at ${formatMoney(s.currentCents)}.`);
    onClose();
  };

  return (
    <Modal title={`Suggestion for ${s.description}`} onClose={onClose}>
      <div className="stack estimate-sheet">
        <div className="occ-summary">
          <KindAvatar kind={s.kind} />
          <div className="occ-summary-main">
            <strong>{s.description}</strong>
            <p className="muted">
              {methodLabel(s)}
              {s.confidence === 'limited' && <span className="badge badge-scheduled estimate-limited">Limited history</span>}
            </p>
          </div>
        </div>

        <dl className="sheet-stats estimate-stats">
          <div>
            <dt>Current estimate</dt>
            <dd>{formatMoney(s.currentCents)}</dd>
          </div>
          <div>
            <dt>Suggested</dt>
            <dd>{formatMoney(s.proposedCents)}</dd>
          </div>
          <div>
            <dt>Change</dt>
            <dd>{changeText(s)}</dd>
          </div>
        </dl>
        <p className="estimate-when">{whenText(s)}</p>

        {confirming ? (
          <div className="stack-sm" role="group" aria-labelledby={`${id}-confirm`}>
            <h3 id={`${id}-confirm`}>Approve this change?</h3>
            <p>
              {s.scope === 'one-payment'
                ? `Expect ${formatMoney(s.proposedCents)} for the ${formatMedium(s.effectiveDate)} ${s.description} payment instead of ${formatMoney(s.currentCents)}. Later payments stay at their current estimate.`
                : `Change the ${s.description} estimate from ${formatMoney(s.currentCents)} to ${formatMoney(s.proposedCents)}, starting with the ${formatMedium(s.effectiveDate)} payment.`}
            </p>
            <p className="hint">Earlier payments and what you've recorded stay as they are. This changes your forecast only.</p>
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                ref={backRef}
                onClick={() => {
                  switched.current = true;
                  setConfirming(null);
                }}
              >
                Go back
              </button>
              <button type="button" className="button primary" onClick={approve}>
                Approve change
              </button>
            </div>
          </div>
        ) : (
          <>
            <p>{s.explanation}</p>
            {s.limitations.length > 0 && (
              <section className="stack-sm" aria-label="Keep in mind">
                <SectionLabel>Keep in mind</SectionLabel>
                <ul className="estimate-notes">
                  {s.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </section>
            )}

            <details className="gap-detail estimate-evidence">
              <summary>
                <span>Payments behind this suggestion</span>
                <span className="hint">
                  {s.observations.filter((o) => o.counted).length} counted of {s.observations.length}
                </span>
              </summary>
              <ul className="gap-entries" aria-label="Payments">
                {s.observations.map((o) => (
                  <li key={o.occurrenceId} className={o.counted ? '' : 'estimate-excluded'}>
                    <span className="gap-entry-name">
                      {formatMedium(o.originalDate)}
                      <span className="hint">
                        {o.actualDate !== o.originalDate ? ` · paid ${formatMedium(o.actualDate)}` : ''} · {o.counted ? 'Counted' : EXCLUDED[o.excluded ?? 'earlier']}
                      </span>
                    </span>
                    <strong>{formatMoney(o.actualAmountCents)}</strong>
                  </li>
                ))}
              </ul>
            </details>

            <div className="stack-sm">
              <button type="button" className="button secondary" aria-expanded={previewing} aria-controls={`${id}-preview`} onClick={() => setPreviewing(!previewing)}>
                {previewing ? 'Hide forecast preview' : 'Preview your forecast'}
              </button>
              {previewing && (
                <section id={`${id}-preview`} aria-label="Forecast preview" className="stack-sm">
                  <EstimatePreviewView data={data} suggestion={s} today={today} />
                </section>
              )}
            </div>

            <FormError message={error} />
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={onClose}>
                Not now
              </button>
              <button type="button" className="button secondary" onClick={dismiss}>
                Dismiss
              </button>
              <button
                type="button"
                className="button primary"
                ref={approveRef}
                onClick={() => {
                  switched.current = true;
                  setError(null);
                  setConfirming(s);
                }}
              >
                Approve…
              </button>
            </div>
            <p className="hint">
              {/* button labels say it — audit #54 */}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function EstimatePreviewView({ data, suggestion, today }: { data: AppData; suggestion: EstimateSuggestion; today: string }) {
  const result = useMemo(() => previewEstimate(data, suggestion, { today, now: `${today}T00:00:00.000Z` }), [data, suggestion, today]);
  if (!result.ok) return <p className="field-error">{result.error}</p>;
  const p: EstimatePreview = result.preview;
  const cur = p.current.lowest;
  const next = p.proposed.lowest;
  return (
    <div className="stack-sm whatif-result">
      {p.comparable && cur && next && (
        <p className="whatif-headline">
          {next.tallyCents > cur.tallyCents
            ? <>Your lowest running total would improve from <Money cents={cur.tallyCents} /> to <Money cents={next.tallyCents} />.</>
            : next.tallyCents < cur.tallyCents
              ? <>Your lowest running total would drop from <Money cents={cur.tallyCents} /> to <Money cents={next.tallyCents} />.</>
              : <>Your lowest running total would stay at <Money cents={cur.tallyCents} />.</>}
        </p>
      )}
      <ul className="gap-entries" aria-label="Payments that change">
        {p.payments.map((x) => (
          <li key={x.occurrenceId}>
            <span className="gap-entry-name">
              {formatMedium(x.date)}
              <span className="hint">
                {x.inRunningTotal && x.currentTallyCents !== null && x.proposedTallyCents !== null
                  ? <> · running total <Money cents={x.currentTallyCents} /> → <Money cents={x.proposedTallyCents} /></>
                  : ' · before your next payday, outside the running total'}
              </span>
            </span>
            <strong>
              {formatMoney(x.currentCents)} → {formatMoney(x.proposedCents)}
            </strong>
          </li>
        ))}
      </ul>
      {!p.comparable && (
        <p className="callout callout-info">
          {p.reason === 'anchor-changed'
            ? 'This moves your first payday, so cash flow is compared instead of running totals.'
            : "There's no upcoming payday to start a running total from."}
        </p>
      )}
      {p.comparable && <GapChanges newGaps={p.newGaps} worsenedGaps={p.worsenedGaps} reducedGaps={p.reducedGaps} resolvedGaps={p.resolvedGaps} proposedGaps={p.proposed.gaps} />}
      <p className="hint">
        {p.continuesAfter ? `Compared through ${formatMedium(p.continuesAfter)}; the new estimate also applies to later payments. ` : ''}
        Nothing is saved until you approve.
      </p>
    </div>
  );
}
