import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { reviewStatus, reviewSummary } from '../../domain/cadence';
import { formatMedium, formatRange, formatShort } from '../../domain/dates';
import { buildForecast, type ForecastEntry } from '../../domain/forecast';
import { formatMoney, formatMoneyIn, formatMoneyOut, formatSignedMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import { doneVerb } from '../../domain/types';
import { useStore } from '../../state/store';
import { FlowAmount, FormError, Icon, Modal, SectionLabel, useToast } from './common';
import { CADENCE_LABEL } from './rhythm';

/**
 * The review for the current period: what is expected, what is recorded,
 * what needs an update, cash flow, and timing gaps, all from the forecast.
 * Done and Skip only mark the review; they never record a payment. Closing
 * leaves it due.
 */
export function PeriodReviewSheet({ onOpen, onClose }: { onOpen: (occurrenceId: string) => void; onClose: () => void }) {
  const { data, today, run } = useStore();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const status = reviewStatus(data, today);
  const start = status.period?.start;
  const end = status.period?.end;
  const summary = useMemo(() => (start && end ? reviewSummary(buildForecast(data, today, { through: end }), { start, end }) : null), [data, today, start, end]);

  if (!summary) {
    return (
      <Modal title="Review" onClose={onClose}>
        <p>There’s no review right now.</p>
      </Modal>
    );
  }

  const finish = (op: typeof ops.completeReview, message: string) => {
    const r = run((d, c) => op(d, c));
    if (!r.ok) return setError(r.error);
    toast(message);
    onClose();
  };
  const { period, cashFlow } = summary;

  return (
    <Modal title={`${CADENCE_LABEL[status.cadence]} review`} onClose={onClose}>
      <div className="stack review-period">
        <p className="muted">{formatRange(period.start, period.end)}</p>
        <dl className="sheet-stats">
          <div>
            <dt>Money in</dt>
            <dd className="amount-in">{formatMoneyIn(cashFlow.incomeCents)}</dd>
          </div>
          <div>
            <dt>Money out</dt>
            <dd className="amount-out">{formatMoneyOut(cashFlow.outflowCents)}</dd>
          </div>
          <div>
            <dt>Cash flow</dt>
            <dd className={cashFlow.netCents < 0 ? 'negative' : ''}>{formatSignedMoney(cashFlow.netCents)}</dd>
          </div>
        </dl>
        <p className="hint">Expected and recorded items for these dates.</p>

        {summary.overdue.length > 0 && (
          <Group label="Needs an update" hint="The date passed and nothing was recorded. They stay expected until you record them." entries={summary.overdue} today={today} onOpen={onOpen} />
        )}
        {summary.gaps.length > 0 && (
          <section className="stack-sm" aria-label="Timing gaps">
            <SectionLabel>Timing gaps</SectionLabel>
            <ul className="review-gap-lines">
              {summary.gaps.map((g) => (
                <li key={g.start} className="negative-text">
                  {formatRange(g.start, g.end)}: down to {formatMoney(g.lowestCents)}
                  {g.recoversOn ? `, back to $0 or more on ${formatShort(g.recoversOn)}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}
        <Group label="Expected income" entries={summary.expectedIncome} today={today} onOpen={onOpen} />
        <Group label="Expected payments" entries={summary.expectedOutflows} today={today} onOpen={onOpen} />
        <Group label="Recorded" entries={summary.recorded} today={today} onOpen={onOpen} />

        <FormError message={error} />
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={() => finish(ops.skipReview, 'Review skipped.')}>
            Skip this one
          </button>
          <button type="button" className="button primary" onClick={() => finish(ops.completeReview, 'Review done.')}>
            Mark review done
          </button>
        </div>
        <p className="hint">Marking the review done doesn’t record any payments or income.</p>
      </div>
    </Modal>
  );
}

function Group({ label, hint, entries, today, onOpen }: { label: string; hint?: string; entries: ForecastEntry[]; today: string; onOpen: (id: string) => void }) {
  return (
    <section className="stack-sm" aria-label={label}>
      <SectionLabel>{label}</SectionLabel>
      {hint && <p className="hint">{hint}</p>}
      {entries.length === 0 ? (
        <p className="hint">None.</p>
      ) : (
        <ul className="entry-list review-period-list">
          {entries.map((e) => {
            const o = e.occurrence;
            const when =
              o.status === 'completed'
                ? `${doneVerb(o.kind)[0]!.toUpperCase()}${doneVerb(o.kind).slice(1)} ${formatMedium(o.actualDate!)}`
                : o.displayStatus === 'overdue'
                  ? `Expected ${formatMedium(o.scheduledDate)} · not recorded`
                  : o.scheduledDate === today
                    ? 'Expected today'
                    : `Expected ${formatMedium(o.scheduledDate)}`;
            return (
              <li key={o.id}>
                <button type="button" className="entry" onClick={() => onOpen(o.id)}>
                  <span className="entry-main">
                    <span className="entry-title">{o.description}</span>
                    <span className="entry-sub">{when}</span>
                  </span>
                  <span className="entry-side">
                    <FlowAmount kind={o.kind} cents={e.amountCents} />
                    <Icon icon={ChevronRight} size={18} className="chevron" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
