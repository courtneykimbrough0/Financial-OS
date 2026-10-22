/**
 * Shifts for hourly and tipped income (E2): an optional record of what was
 * earned, shown on the income's sheet. Earnings are never money in: cash tips
 * become one received income record on the shift's date, and wages and card
 * tips wait for the paycheck that pays them. The expected paychecks stay as
 * entered.
 */
import { useState, type FormEvent } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { formatMedium, formatShort, type DateStr } from '../../domain/dates';
import { earnedNotPaid, formatHours, shiftEarnings, shiftsFor } from '../../domain/earnings';
import { centsToInput, formatMoney, parseMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import type { RecurringSource, WorkEntry } from '../../domain/types';
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

/** The paycheck that paid a shift, as "the Oct 30 paycheck". */
function paycheckName(data: ReturnType<typeof useStore>['data'], occurrenceId: string): string {
  const r = data.records.find((x) => x.id === occurrenceId);
  return r?.actualDate ? `the ${formatShort(r.actualDate)} paycheck` : 'a paycheck';
}

/** On an income's sheet: earned, not paid yet, the latest shifts, and Log a shift. */
export function ShiftsSection({ source, onLog, onOpen }: { source: RecurringSource; onLog: () => void; onOpen: (id: string) => void }) {
  const { data } = useStore();
  const shifts = shiftsFor(data, source.id);
  const notPaid = earnedNotPaid(data, source.id);
  return (
    <section className="stack-sm" aria-labelledby="item-shifts">
      <SectionLabel
        id="item-shifts"
        action={
          <button type="button" className="button small secondary" onClick={onLog}>
            <Icon icon={Plus} size={16} /> Log a shift
          </button>
        }
      >
        Shifts
      </SectionLabel>
      {shifts.length === 0 ? (
        <p className="hint">Optional. Log hours and tips to see what you earn. Your expected paychecks stay as you entered them.</p>
      ) : (
        <>
          <dl className="details">
            <div>
              <dt>Earned, not paid yet</dt>
              <dd>{formatMoney(notPaid.cents)}</dd>
            </div>
          </dl>
          <p className="hint">Wages and card tips arrive in your paycheck, so they count when you record it. Cash tips count on the day of the shift.</p>
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
  const parts = [shift.minutes ? formatHours(shift.minutes) : null, earned.cashTipsCents ? `${formatMoney(earned.cashTipsCents)} cash` : null, earned.cardTipsCents ? `${formatMoney(earned.cardTipsCents)} card` : null].filter(Boolean);
  return (
    <button type="button" className="entry" onClick={onOpen}>
      <span className="entry-main">
        <span className="entry-title">{formatMedium(shift.date)}</span>
        <span className="entry-sub">{parts.join(' · ')}</span>
        <span className="entry-sub">{shift.paidByOccurrenceId ? `Paid in ${paycheckName(data, shift.paidByOccurrenceId)}` : 'Not paid yet'}</span>
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
      <Modal title="Shift" onClose={onDone}>
        <p>This shift no longer exists.</p>
      </Modal>
    );
  }

  const money = (text: string) => (text.trim() === '' ? null : parseMoney(text));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const minutes = parseHours(hours);
    if (Number.isNaN(minutes)) errs.hours = 'Enter hours like 6.5 or 6:30.';
    const values = { wage: money(wage), cash: money(cash), card: money(card) };
    for (const [key, text] of [['wage', wage], ['cash', cash], ['card', card]] as const) if (text.trim() !== '' && values[key] === null) errs[key] = 'Enter an amount, like 42 or 42.50.';
    if (!date) errs.date = 'Choose a date.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    const input = { date, minutes, wageCents: values.wage, cashTipsCents: values.cash, cardTipsCents: values.card };
    const result = run((d, c) => (shift ? ops.editShift(d, shift.id, input, c) : ops.logShift(d, { ...input, sourceId: source.id }, c)));
    if (!result.ok) return setError(result.error);
    const tips = values.cash ? ` ${formatMoney(values.cash)} cash tips added to ${date === today ? 'today' : formatShort(date)}.` : '';
    toast(shift ? `Shift saved.${tips}` : `Shift logged.${tips}`);
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
      <Modal title="Delete this shift?" onClose={() => setConfirmDelete(false)}>
        <div className="stack">
          <p>{shift.cashTipsRecordId ? 'Its cash tips come off your cash flow too. ' : ''}A paycheck you've recorded stays as it is.</p>
          <FormError message={error} />
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setConfirmDelete(false)} data-autofocus>
              Keep it
            </button>
            <button type="button" className="button danger" onClick={() => act((d) => ops.deleteShift(d, shift.id), 'Shift deleted.')}>
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
    <Modal title={shift ? `Shift on ${formatMedium(shift.date)}` : 'Log a shift'} onClose={onDone}>
      <form onSubmit={submit} noValidate className="stack">
        <p className="hint">{source.description}</p>
        <Field label="Date" error={fieldErrors.date}>
          {(p) => <input {...p} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Hours (optional)" error={fieldErrors.hours} hint="Like 6.5 or 6:30.">
          {(p) => <input {...p} type="text" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} data-autofocus />}
        </Field>
        <Field label="Hourly wage (optional)" error={fieldErrors.wage}>
          {(p) => <MoneyInput {...p} value={wage} onChange={setWage} />}
        </Field>
        <Field label="Cash tips (optional)" error={fieldErrors.cash} hint="Money in on the day of the shift.">
          {(p) => <MoneyInput {...p} value={cash} onChange={setCash} />}
        </Field>
        <Field label="Card tips (optional)" error={fieldErrors.card} hint="Paid in your paycheck, so they count when you record it.">
          {(p) => <MoneyInput {...p} value={card} onChange={setCard} />}
        </Field>
        {shift && (
          <p className="hint">
            {shift.paidByOccurrenceId ? `Wages and card tips paid in ${paycheckName(data, shift.paidByOccurrenceId)}.` : 'Wages and card tips not paid yet.'}
          </p>
        )}
        <FormError message={error} />
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            {shift ? 'Save shift' : 'Log shift'}
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
              <button type="button" className="button secondary" onClick={() => act((d, c) => ops.setShiftPaid(d, shift.id, paycheck.id, c), `Marked paid in the ${formatShort(paycheck.actualDate!)} paycheck.`)}>
                Paid in the {formatShort(paycheck.actualDate!)} paycheck
              </button>
            )}
            <button type="button" className="button danger-link" onClick={() => setConfirmDelete(true)}>
              Delete shift
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
