import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dayOfWeek, formatMedium, formatShort, WEEKDAYS_SHORT, type DateStr } from '../../domain/dates';
import type { ForecastEntry } from '../../domain/forecast';
import { formatMoney } from '../../domain/money';
import { FlowAmount, Icon, KindAvatar, KindTag, StatusBadge } from './common';

/** "Mon, Oct 19". */
export function shortDay(date: DateStr): string {
  return `${WEEKDAYS_SHORT[dayOfWeek(date)]}, ${formatShort(date)}`;
}

/** Previous / next with a label between them, and a Today shortcut when the view has moved. */
export function PeriodNav({
  label,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
  prevLabel: string;
  nextLabel: string;
  onPrev?: () => void;
  onNext?: () => void;
  onToday?: () => void;
}) {
  return (
    <div className="period-nav">
      <button type="button" className="icon-button" onClick={onPrev} disabled={!onPrev} aria-label={prevLabel}>
        <Icon icon={ChevronLeft} size={22} />
      </button>
      <h2 aria-live="polite">{label}</h2>
      {onToday && (
        <button type="button" className="button small secondary" onClick={onToday}>
          Today
        </button>
      )}
      <button type="button" className="icon-button" onClick={onNext} disabled={!onNext} aria-label={nextLabel}>
        <Icon icon={ChevronRight} size={22} />
      </button>
    </div>
  );
}

/** One forecast entry as a tappable row: what, its kind and status, any change from what was expected, and its amount. */
export function EntryButton({ e, onOpen, extra }: { e: ForecastEntry; onOpen: (id: string) => void; extra?: ReactNode }) {
  const o = e.occurrence;
  let sub: string | null = null;
  if (e.carriedForward) sub = `Overdue since ${formatMedium(o.scheduledDate)}`;
  else if (o.status === 'completed' && (o.actualDate !== o.expectedDate || o.actualAmountCents !== o.expectedAmountCents)) {
    sub = `Expected ${formatMoney(o.expectedAmountCents)} on ${formatShort(o.expectedDate)}`;
  } else if (o.status === 'scheduled' && (o.scheduledDate !== o.expectedDate || o.scheduledAmountCents !== o.expectedAmountCents)) {
    sub = `Changed from ${formatMoney(o.expectedAmountCents)} on ${formatShort(o.expectedDate)}`;
  }
  return (
    <button type="button" className="entry" onClick={() => onOpen(o.id)}>
      <KindAvatar kind={o.kind} />
      <span className="entry-main">
        <span className="entry-title">{o.description}</span>
        <span className="entry-tags">
          <KindTag kind={o.kind} />
          <StatusBadge status={o.displayStatus} kind={o.kind} release={o.release} />
        </span>
        {sub && <span className="entry-sub">{sub}</span>}
        {extra}
      </span>
      <span className="entry-side">
        <FlowAmount kind={o.kind} cents={e.amountCents} strike={!e.counts} release={o.release} />
        <Icon icon={ChevronRight} size={18} className="chevron" />
      </span>
    </button>
  );
}
