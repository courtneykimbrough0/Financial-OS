/**
 * Shifts for hourly and tipped income (E2) and sessions for gig income (E4):
 * an optional record of what was earned, shown on the income's sheet.
 * Earnings are never money in: cash (tips, or cash received in a session)
 * becomes one received income record on its date, and wages, card tips and
 * platform earnings wait for the paycheck or payout that pays them. Expected
 * paychecks and payouts stay as entered.
 */
import { useState, type FormEvent } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { formatMedium, formatShort, type DateStr } from '../../domain/dates';
import { earnedNotPaid, formatHours, shiftEarnings, shiftsFor, waitingByPlatform } from '../../domain/earnings';
import { centsToInput, formatMoney, parseMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import { workKindFor, type RecurringSource, type WorkEntry } from '../../domain/types';
import { useStore } from '../../state/store';
import { Field, FormError, Icon, Modal, MoneyInput, SectionLabel, useToast } from './common';

/** How many shifts the sheet lists; the rest wait for the Earnings views (E5). */
const SHOWN = 8;

/** "6.5", "6:30" or "" → minutes; null for empty; NaN for anything else. */
export function parseHours(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const decimal = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(t);
  if (decimal) return Math.round(Number(`${decimal[1]}.${decimal[2] ?? '0'}`) * 60);
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  return NaN;
}

const hoursInput = (minutes: number | undefined) => (minutes ? String(Math.round((minutes / 60) * 100) / 100) : '');

/** Words that differ between shifts and gig sessions. */
const WORDS = {
  shift: { one: 'shift', heading: 'Shifts', log: 'Log a shift', pay: 'paycheck', notPaid: 'Earned, not paid yet', cash: 'cash tips' },
  session: { one: 'session', heading: 'Sessions', log: 'Log a session', pay: 'payout', notPaid: 'Waiting for payout', cash: 'cash' },
} as const;
const kindOf = (source: RecurringSource) => workKindFor(source.incomeType) ?? 'shift';

/** The paycheck or payout that paid a shift or session, as "the Oct 30 paycheck". */
function paycheckName(data: ReturnType<typeof useStore>['data'], occurrenceId: string, pay: string): string {
  const r = data.records.find((x) => x.id === occurrenceId);
  return r?.actualDate ? `the ${formatShort(r.actualDate)} ${pay}` : `a ${pay}`;
}

/** On an income's sheet: earned, not paid yet, the latest shifts, and Log a shift. */
export function ShiftsSection({ source, onLog, onOpen }: { source: RecurringSource; onLog: () => void; onOpen: (id: string) => void }) {
  const { data } = useStore();
  const kind = kindOf(source);
  const words = WORDS[kind];
  const shifts = shiftsFor(data, source.id);
  const notPaid = earnedNotPaid(data, source.id);
  const platforms = kind === 'session' ? waitingByPlatform(data, source.id) : [];
  return (
    <section className="stack-sm" aria-labelledby="item-shifts">
      <SectionLabel
        id="item-shifts"
        action={
          <button type="button" className="button small secondary" onClick={onLog}>
            <Icon icon={Plus} size={16} /> {words.log}
          </button>
        }
      >
        {words.heading}
      </SectionLabel>
      {shifts.length === 0 ? (
        <p className="hint">
          {kind === 'session'
            ? "Optional. Log sessions to see what you earn and what's waiting for payout. Your expected payouts stay as you entered them."
            : 'Optional. Log hours and tips to see what you earn. Your expected paychecks stay as you entered them.'}
        </p>
      ) : (
        <>
          <dl className="details">
            <div>
              <dt>{words.notPaid}</dt>
              <dd>{formatMoney(notPaid.cents)}</dd>
            </div>
            {platforms.length > 1 &&
              platforms.map((p) => (
                <div key={p.platform ?? ''}>
                  <dt>{p.platform ?? 'No platform'}</dt>
                  <dd>{formatMoney(p.cents)}</dd>
                </div>
              ))}
          </dl>
          <p className="hint">
            {kind === 'session'
              ? 'Platform earnings arrive with a payout, so they count when you record it. Cash counts on the day of the session.'
              : 'Wages and card tips arrive in your paycheck, so they count when you record it. Cash tips count on the day of the shift.'}
          </p>
          <ul className="entry-list">
            {shifts.slice(0, SHOWN).map((e) => (
              <li key={e.id}>
                <ShiftRow shift={e} onOpen={() => onOpen(e.id)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ShiftRow({ shift, onOpen }: { shift: WorkEntry; onOpen: () => void }) {
  const { data } = useStore();
  const earned = shiftEarnings(shift);
  const session = shift.kind === 'session';
  const parts = [
    shift.minutes ? formatHours(shift.minutes) : null,
    session ? (shift.platform ?? null) : null,
    earned.earningsCents ? `${formatMoney(earned.earningsCents)} earnings` : null,
    earned.cashTipsCents ? `${formatMoney(earned.cashTipsCents)} cash` : null,
    earned.cardTipsCents ? `${formatMoney(earned.cardTipsCents)} card` : null,
  ].filter(Boolean);
  return (
    <button type="button" className="entry" onClick={onOpen}>
      <span className="entry-main">
        <span className="entry-title">{formatMedium(shift.date)}</span>
        <span className="entry-sub">{parts.join(' · ')}</span>
        <span className="entry-sub">
          {shift.paidByOccurrenceId ? `Paid in ${paycheckName(data, shift.paidByOccurrenceId, session ? 'payout' : 'paycheck')}` : session ? 'Waiting for payout' : 'Not paid yet'}
        </span>
      </span>
      <span className="entry-side">
        <span className="amount">{formatMoney(earned.totalCents)}</span>
        <span className="hint">earned</span>
      </span>
      <Icon icon={ChevronRight} size={18} className="chevron" />
    </button>
  );
}

/** Log a new shift, or change, mark paid or delete one. Returns to the income's sheet when done. */
export function ShiftSheet({ source, shiftId, onDone }: { source: RecurringSource; shiftId: string | null; onDone: () => void }) {
  const { data, today, run } = useStore();
  const toast = useToast();
  const shift = shiftId ? (data.workEntries ?? []).find((e) => e.id === shiftId) : undefined;
  const kind = kindOf(source);
  const words = WORDS[kind];
  const session = kind === 'session';
  const [platform, setPlatform] = useState(shift?.platform ?? '');
  const [earnings, setEarnings] = useState(shift?.earningsCents ? centsToInput(shift.earningsCents) : '');
  const [date, setDate] = useState<DateStr>(shift?.date ?? today);
  const [hours, setHours] = useState(hoursInput(shift?.minutes));
  const [wage, setWage] = useState(shift?.wageCents ? centsToInput(shift.wageCents) : source.hourlyWageCents && !shift ? centsToInput(source.hourlyWageCents) : '');
  const [cash, setCash] = useState(shift?.cashTipsCents ? centsToInput(shift.cashTipsCents) : '');
  const [card, setCard] = useState(shift?.cardTipsCents ? centsToInput(shift.cardTipsCents) : '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (shiftId && !shift) {
    return (
      <Modal title={session ? 'Session' : 'Shift'} onClose={onDone}>
        <p>This {words.one} no longer exists.</p>
      </Modal>
    );
  }

  const money = (text: string) => (text.trim() === '' ? null : parseMoney(text));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const minutes = parseHours(hours);
    if (Number.isNaN(minutes)) errs.hours = 'Enter hours like 6.5 or 6:30.';
    const values = { wage: money(wage), cash: money(cash), card: money(card), earnings: money(earnings) };
    for (const [key, text] of [['wage', wage], ['cash', cash], ['card', card], ['earnings', earnings]] as const) if (text.trim() !== '' && values[key] === null) errs[key] = 'Enter an amount, like 42 or 42.50.';
    if (!date) errs.date = 'Choose a date.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    const input = session
      ? { date, minutes, cashTipsCents: values.cash, earningsCents: values.earnings, platform: platform.trim() || null }
      : { date, minutes, wageCents: values.wage, cashTipsCents: values.cash, cardTipsCents: values.card };
    const result = run((d, c) => (shift ? ops.editShift(d, shift.id, input, c) : ops.logShift(d, { ...input, sourceId: source.id }, c)));
    if (!result.ok) return setError(result.error);
    const tips = values.cash ? ` ${formatMoney(values.cash)} ${words.cash} added to ${date === today ? 'today' : formatShort(date)}.` : '';
    const name = session ? 'Session' : 'Shift';
    toast(shift ? `${name} saved.${tips}` : `${name} logged.${tips}`);
    onDone();
  };

  const act = (op: Parameters<typeof run>[0], message: string) => {
    const r = run(op);
    if (!r.ok) return setError(r.error);
    toast(message);
    onDone();
  };

  if (shift && confirmDelete) {
    return (
      <Modal title={`Delete this ${words.one}?`} onClose={() => setConfirmDelete(false)}>
        <div className="stack">
          <p>
            {shift.cashTipsRecordId ? `Its ${words.cash} come${session ? 's' : ''} off your cash flow too. ` : ''}A {words.pay} you've recorded stays as it is.
          </p>
          <FormError message={error} />
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setConfirmDelete(false)} data-autofocus>
              Keep it
            </button>
            <button type="button" className="button danger" onClick={() => act((d) => ops.deleteShift(d, shift.id), session ? 'Session deleted.' : 'Shift deleted.')}>
              Delete
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // A paycheck from this income, recorded on or after the shift, that could have paid it.
  const paycheck = shift && !shift.paidByOccurrenceId
    ? data.records
        .filter((r) => r.sourceId === source.id && r.status === 'completed' && r.actualDate !== null && r.actualDate >= shift.date)
        .sort((a, b) => (a.actualDate! < b.actualDate! ? -1 : 1))[0]
    : undefined;

  return (
    <Modal title={shift ? `${session ? 'Session' : 'Shift'} on ${formatMedium(shift.date)}` : words.log} onClose={onDone}>
      <form onSubmit={submit} noValidate className="stack">
        <p className="hint">{source.description}</p>
        <Field label="Date" error={fieldErrors.date}>
          {(p) => <input {...p} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Hours (optional)" error={fieldErrors.hours} hint="Like 6.5 or 6:30.">
          {(p) => <input {...p} type="text" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} data-autofocus />}
        </Field>
        {session ? (
          <>
            <Field label="Platform (optional)" hint="Like DoorDash or Uber.">
              {(p) => <input {...p} type="text" maxLength={40} list="session-platforms" value={platform} onChange={(e) => setPlatform(e.target.value)} />}
            </Field>
            <datalist id="session-platforms">
              {[...new Set((data.workEntries ?? []).map((e) => e.platform).filter((x): x is string => !!x))].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <Field label="Earnings on the platform (optional)" error={fieldErrors.earnings} hint="Paid out later, so they count when you record the payout.">
              {(p) => <MoneyInput {...p} value={earnings} onChange={setEarnings} />}
            </Field>
            <Field label="Cash received (optional)" error={fieldErrors.cash} hint="Money in on the day of the session.">
              {(p) => <MoneyInput {...p} value={cash} onChange={setCash} />}
            </Field>
          </>
        ) : (
          <>
            <Field label="Hourly wage (optional)" error={fieldErrors.wage}>
              {(p) => <MoneyInput {...p} value={wage} onChange={setWage} />}
            </Field>
            <Field label="Cash tips (optional)" error={fieldErrors.cash} hint="Money in on the day of the shift.">
              {(p) => <MoneyInput {...p} value={cash} onChange={setCash} />}
            </Field>
            <Field label="Card tips (optional)" error={fieldErrors.card} hint="Paid in your paycheck, so they count when you record it.">
              {(p) => <MoneyInput {...p} value={card} onChange={setCard} />}
            </Field>
          </>
        )}
        {shift && (
          <p className="hint">
            {session
              ? shift.paidByOccurrenceId
                ? `Earnings paid out in ${paycheckName(data, shift.paidByOccurrenceId, 'payout')}.`
                : 'Earnings waiting for payout.'
              : shift.paidByOccurrenceId
                ? `Wages and card tips paid in ${paycheckName(data, shift.paidByOccurrenceId, 'paycheck')}.`
                : 'Wages and card tips not paid yet.'}
          </p>
        )}
        <FormError message={error} />
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            {shift ? `Save ${words.one}` : `Log ${words.one}`}
          </button>
        </div>
        {shift && (
          <div className="action-list">
            {shift.paidByOccurrenceId && (
              <button type="button" className="button secondary" onClick={() => act((d, c) => ops.setShiftPaid(d, shift.id, null, c), 'Marked not paid yet.')}>
                Mark not paid yet
              </button>
            )}
            {paycheck && (
              <button type="button" className="button secondary" onClick={() => act((d, c) => ops.setShiftPaid(d, shift.id, paycheck.id, c), `Marked paid in the ${formatShort(paycheck.actualDate!)} ${words.pay}.`)}>
                Paid in the {formatShort(paycheck.actualDate!)} {words.pay}
              </button>
            )}
            <button type="button" className="button danger-link" onClick={() => setConfirmDelete(true)}>
              Delete {words.one}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
