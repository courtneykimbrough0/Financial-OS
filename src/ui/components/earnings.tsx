/**
 * Earnings in Activity (E5): an optional, read-only look at what was earned
 * from logged shifts, sessions and jobs, set beside what was received. It
 * appears only when there is earnings data. Nothing here changes data, and
 * no figure here is added to cash flow: received money is already counted in
 * the month's summary, and is only listed here.
 */
import { Fragment, useState } from 'react';
import { formatShort } from '../../domain/dates';
import { formatHours } from '../../domain/earnings';
import type { EarningsHistory, ReceivedFor, SourceEarnings } from '../../domain/earnings-history';
import { formatMoney } from '../../domain/money';
import { BreakdownRow } from './plan';
import { paymentText } from './freelance';
import { Modal, SectionLabel } from './common';

const RECEIVED_LABEL: Record<ReceivedFor, string> = {
  paycheck: 'Paycheck',
  payout: 'Payout',
  'cash-tips': 'Cash tips',
  'session-cash': 'Cash from a session',
  'job-payment': 'Job payment',
};

const perHour = (cents: number) => `${formatMoney(cents)}/h`;

/** Everything not received yet, today: unpaid wages and tips, earnings waiting for payout, and done jobs. */
export function notReceivedCents(h: EarningsHistory): number {
  return h.notReceived.reduce((n, s) => n + s.cents, 0) + h.jobs.doneNotPaidCents;
}

/** The Earnings card on Activity, with the month's details in a sheet. */
export function EarningsSection({ history, month }: { history: EarningsHistory; month: string }) {
  const [open, setOpen] = useState(false);
  const h = history;
  const waiting = notReceivedCents(h);
  return (
    <section className="stack-sm" aria-labelledby="activity-earnings">
      <SectionLabel
        id="activity-earnings"
        action={
          <button type="button" className="button small secondary" onClick={() => setOpen(true)}>
            Details
          </button>
        }
      >
        Earnings
      </SectionLabel>
      <div className="card stack-sm">
        <dl className="breakdown">
          {h.work.shifts > 0 && <BreakdownRow label="Earned from work" value={formatMoney(h.work.totalCents)} />}
          {h.work.minutes > 0 && <BreakdownRow label="Hours" value={formatHours(h.work.minutes)} />}
          {h.work.effectiveHourlyCents !== null && <BreakdownRow label="Effective hourly" value={perHour(h.work.effectiveHourlyCents)} />}
          {h.jobs.paidCents > 0 && <BreakdownRow label="Jobs paid" value={formatMoney(h.jobs.paidCents)} />}
          {waiting > 0 && <BreakdownRow label="Not received yet" value={formatMoney(waiting)} />}
          <BreakdownRow label="Received for work" value={formatMoney(h.receivedCents)} tone={h.receivedCents > 0 ? 'in' : undefined} />
        </dl>
        {h.work.shifts === 0 && <p className="hint">No shifts or sessions logged in {month}.</p>}
        <p className="hint">Earnings count in cash flow only when you receive them. Received for work is already in the summary above.</p>
      </div>
      {open && <EarningsSheet history={h} month={month} onClose={() => setOpen(false)} />}
    </section>
  );
}

function SourceBlock({ s }: { s: SourceEarnings }) {
  const session = s.kind === 'session';
  const m = s.summary;
  return (
    <div className="card">
      <h3 className="subhead">{s.source.description}</h3>
      <dl className="breakdown">
        <BreakdownRow label={session ? 'Sessions' : 'Shifts'} value={String(m.shifts)} />
        {m.minutes > 0 && <BreakdownRow label="Hours" value={formatHours(m.minutes)} />}
        <BreakdownRow label="Earned" value={formatMoney(m.totalCents)} />
        {m.wagesCents > 0 && <BreakdownRow label="Wages" value={formatMoney(m.wagesCents)} level={1} />}
        {m.earningsCents > 0 && <BreakdownRow label="Platform earnings" value={formatMoney(m.earningsCents)} level={1} />}
        {m.cashTipsCents > 0 && <BreakdownRow label={session ? 'Cash received' : 'Cash tips'} value={formatMoney(m.cashTipsCents)} level={1} />}
        {m.cardTipsCents > 0 && <BreakdownRow label="Card tips" value={formatMoney(m.cardTipsCents)} level={1} />}
        {m.effectiveHourlyCents !== null && <BreakdownRow label="Effective hourly" value={perHour(m.effectiveHourlyCents)} />}
      </dl>
    </div>
  );
}

/** The month's earnings in full. Read-only: it lists, it never records or changes. */
function EarningsSheet({ history: h, month, onClose }: { history: EarningsHistory; month: string; onClose: () => void }) {
  const waiting = notReceivedCents(h);
  return (
    <Modal title={`Earnings · ${month}`} onClose={onClose}>
      <div className="stack-lg">
        <section className="stack-sm" aria-labelledby="earnings-work">
          <SectionLabel id="earnings-work">Work in {month}</SectionLabel>
          {h.bySource.length === 0 ? <p className="hint">No shifts or sessions logged in {month}.</p> : h.bySource.map((s) => <SourceBlock key={s.source.id} s={s} />)}
          {h.bySource.length > 0 && <p className="hint">Effective hourly is what you earned per hour, counting only shifts and sessions with hours.</p>}
        </section>

        {(waiting > 0 || h.jobs.planned.length > 0) && (
          <section className="stack-sm" aria-labelledby="earnings-waiting">
            <SectionLabel id="earnings-waiting">Not received yet</SectionLabel>
            <div className="card">
              <dl className="breakdown">
                {h.notReceived.map((n) => (
                  <Fragment key={n.source.id}>
                    <BreakdownRow label={`${n.source.description} · ${n.kind === 'session' ? 'waiting for payout' : 'earned, not paid yet'}`} value={formatMoney(n.cents)} />
                    {n.platforms.map((p) => (
                      <BreakdownRow key={p.platform ?? ''} label={p.platform ?? 'No platform'} value={formatMoney(p.cents)} level={1} />
                    ))}
                  </Fragment>
                ))}
                {h.jobs.doneNotPaid.length > 0 && <BreakdownRow label="Jobs done, not paid yet" value={formatMoney(h.jobs.doneNotPaidCents)} />}
                {h.jobs.doneNotPaid.map((v) => (
                  <BreakdownRow key={v.job.id} label={`${v.job.description} · ${paymentText(v).text}`} value={formatMoney(v.amountCents)} level={1} />
                ))}
                {h.jobs.planned.length > 0 && <BreakdownRow label={h.jobs.planned.length === 1 ? 'Planned job' : `Planned jobs (${h.jobs.planned.length})`} value={formatMoney(h.jobs.plannedCents)} />}
              </dl>
            </div>
            <p className="hint">As of today. Not received yet counts when the paycheck, payout or payment is recorded. Planned work isn't earned yet.</p>
          </section>
        )}

        <section className="stack-sm" aria-labelledby="earnings-received">
          <SectionLabel id="earnings-received">Received in {month}</SectionLabel>
          {h.received.length === 0 ? (
            <p className="hint">No paychecks, payouts, cash or job payments recorded in {month}.</p>
          ) : (
            <>
              <ul className="summary-list" aria-label={`Received in ${month}`}>
                {h.received.map((r) => (
                  <li key={r.entry.occurrence.id} className="summary-row">
                    <span className="entry-main">
                      <span className="entry-title">{r.entry.occurrence.description}</span>
                      <span className="entry-sub">
                        {RECEIVED_LABEL[r.for]} · {formatShort(r.entry.date)}
                      </span>
                    </span>
                    <span className="entry-side">
                      <span className="amount amount-in">+{formatMoney(r.entry.amountCents)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <dl className="breakdown">
                <BreakdownRow label="Received for work" value={formatMoney(h.receivedCents)} tone="in" strong />
              </dl>
            </>
          )}
          <p className="hint">Already counted in this month's cash flow, as recorded. Listed here, not added again.</p>
        </section>
      </div>
    </Modal>
  );
}
