import { ChevronRight, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { addDays, formatMedium, formatRange, formatShort, type DateStr } from '../../domain/dates';
import { GAP_LOOKAHEAD_DAYS, type TimingGap } from '../../domain/forecast';
import { formatMoney } from '../../domain/money';
import { Icon, Modal } from './common';

const countLabel = (n: number) => (n === 1 ? '1 timing gap ahead' : `${n} timing gaps ahead`);

/**
 * Warning banner shown only when the running tally goes below $0 in the next
 * 90 days. Opens a sheet listing every gap. It informs; it does not advise.
 */
export function TimingGapsBanner({ gaps, from }: { gaps: TimingGap[]; from: DateStr }) {
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
        <Modal title={countLabel(gaps.length)} onClose={() => setOpen(false)}>
          <div className="stack">
            <p className="gap-intro">
              <Icon icon={TriangleAlert} size={18} />
              <span>Scheduled money out runs ahead of money in on these dates, so the running total drops below $0.</span>
            </p>
            <ul className="gap-list">
              {gaps.map((g) => (
                <li key={g.start}>
                  <span className="gap-dates">
                    {formatRange(g.start, g.end)}
                    <span className="hint"> · {g.days === 1 ? '1 day' : `${g.days} days`}</span>
                  </span>
                  <span className="gap-low">
                    Down to <strong>{formatMoney(g.lowestCents)}</strong> on {formatShort(g.lowestDate)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="hint">
              Covers {formatMedium(from)} through {formatMedium(addDays(from, GAP_LOOKAHEAD_DAYS - 1))}. The running total shows timing, separate from your bank balance.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
