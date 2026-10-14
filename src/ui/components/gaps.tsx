import { ChevronRight, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { addDays, formatMedium, formatRange, formatShort, type DateStr } from '../../domain/dates';
import { compareEntries, GAP_LOOKAHEAD_DAYS, type ForecastEntry, type GapExplanation } from '../../domain/forecast';
import { formatMoney } from '../../domain/money';
import { FlowAmount, Icon, Modal } from './common';

const countLabel = (n: number) => (n === 1 ? '1 timing gap ahead' : `${n} timing gaps ahead`);

/**
 * Warning banner shown only when the running tally goes below $0 in the next
 * 90 days. Opens a sheet explaining every gap. It informs; it does not advise.
 */
export function TimingGapsBanner({ gaps, from, horizonEnd }: { gaps: GapExplanation[]; from: DateStr; horizonEnd: DateStr }) {
  const [open, setOpen] = useState(false);
  if (gaps.length === 0) return null;
  return (
    <>
      <button type="button" className="gap-banner" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon icon={TriangleAlert} size={22} />
        <span className="gap-banner-text">
          <strong>{countLabel(gaps.length)}</strong>
          <span>Next {GAP_LOOKAHEAD_DAYS} days</span>
        </span>
        <Icon icon={ChevronRight} size={18} />
      </button>
      {open && (
        <GapsSheet
          gaps={gaps}
          horizonEnd={horizonEnd}
          onClose={() => setOpen(false)}
          note={`Covers ${formatMedium(from)} through ${formatMedium(addDays(from, GAP_LOOKAHEAD_DAYS - 1))}.`}
        />
      )}
    </>
  );
}

/** Sheet explaining one or more timing gaps, each from the forecast's own entries and running totals. */
export function GapsSheet({
  gaps,
  horizonEnd,
  note,
  onClose,
  onWhatIf,
}: {
  gaps: GapExplanation[];
  horizonEnd: DateStr;
  note?: string;
  onClose: () => void;
  /** When given, outstanding entries offer "What if…" to preview a change to them. */
  onWhatIf?: (occurrenceId: string) => void;
}) {
  return (
    <Modal title={countLabel(gaps.length)} onClose={onClose}>
      <div className="stack">
        <p className="gap-intro">
          <Icon icon={TriangleAlert} size={18} />
          <span>On these dates, scheduled money out runs ahead of money in, so the running total drops below $0. Each one shows what leads to its lowest point and what brings it back.</span>
        </p>
        <ul className="gap-list">
          {gaps.map((g, i) => (
            <li key={g.start}>
              <details className="gap-detail" open={i === 0}>
                <summary>
                  <span className="gap-dates">
                    {formatRange(g.start, g.end)}
                    <span className="hint"> · {g.days === 1 ? '1 day' : `${g.days} days`}</span>
                  </span>
                  <span className="gap-low">
                    Down to <strong>{formatMoney(g.lowestCents)}</strong> on {formatShort(g.lowestDate)}
                  </span>
                </summary>
                <GapDetail gap={g} horizonEnd={horizonEnd} onWhatIf={onWhatIf} />
              </details>
            </li>
          ))}
        </ul>
        <p className="hint">
          {note ? `${note} ` : ''}The running total shows timing, separate from your bank balance.
        </p>
      </div>
    </Modal>
  );
}

function GapDetail({ gap, horizonEnd, onWhatIf }: { gap: GapExplanation; horizonEnd: DateStr; onWhatIf?: (id: string) => void }) {
  const toLowest = [...gap.outflows, ...gap.inflows].sort(compareEntries);
  return (
    <div className="gap-explain stack-sm">
      <p className="gap-total">
        <span>Running total before, {formatShort(addDays(gap.start, -1))}</span>
        <strong>{formatMoney(gap.beforeCents)}</strong>
      </p>

      <h3 className="gap-step">Leading to the lowest point</h3>
      <EntryLines entries={toLowest} onWhatIf={onWhatIf} />
      <p className="gap-total">
        <span>Running total, {formatShort(gap.lowestDate)}</span>
        <strong className="negative-text">{formatMoney(gap.lowestCents)}</strong>
      </p>

      {gap.afterLowest.length > 0 && (
        <>
          <h3 className="gap-step">While still below $0</h3>
          <EntryLines entries={gap.afterLowest} onWhatIf={onWhatIf} />
        </>
      )}

      <h3 className="gap-step">Back to $0 or more</h3>
      {gap.recoversOn && gap.recoveryCents !== null ? (
        <>
          <EntryLines entries={gap.recoveryEntries} onWhatIf={onWhatIf} />
          <p className="gap-total">
            <span>Running total, {formatShort(gap.recoversOn)}</span>
            <strong>{formatMoney(gap.recoveryCents)}</strong>
          </p>
        </>
      ) : (
        <p className="muted">The running total doesn’t return to $0 or more in the forecast, which runs through {formatMedium(horizonEnd)}.</p>
      )}
    </div>
  );
}

function EntryLines({ entries, onWhatIf }: { entries: ForecastEntry[]; onWhatIf?: (id: string) => void }) {
  if (entries.length === 0) return <p className="hint">Nothing scheduled.</p>;
  return (
    <ul className="gap-entries">
      {entries.map((e) => (
        <li key={e.occurrence.id}>
          <span className="gap-entry-date">{formatShort(e.date)}</span>
          <span className="gap-entry-name">{e.occurrence.description}</span>
          <FlowAmount kind={e.occurrence.kind} cents={e.amountCents} />
          {onWhatIf && e.occurrence.status === 'scheduled' && (
            <button
              type="button"
              className="button small link gap-whatif"
              onClick={() => onWhatIf(e.occurrence.id)}
              aria-label={`What if: ${e.occurrence.description}, ${formatShort(e.date)}`}
            >
              What if…
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
