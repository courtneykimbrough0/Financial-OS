import { useState, type FormEvent } from 'react';
import { formatMedium, parts, type DateStr } from '../../domain/dates';
import { centsToInput, formatMoney, parseMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import { describeRule, nextOccurrenceOnOrAfter } from '../../domain/recurrence';
import type { RecurrenceRule, RecurringSource, TransactionKind } from '../../domain/types';
import { useStore } from '../../state/store';
import { Field, FormError, MoneyInput, useToast } from './common';

export const KIND_COPY: Record<
  TransactionKind,
  { noun: string; nameLabel: string; placeholder: string; amountLabel: string; dateLabel: string; categories: string[] }
> = {
  income: {
    noun: 'income',
    nameLabel: 'What is this income?',
    placeholder: 'e.g. Paycheck from work',
    amountLabel: 'Amount you expect to receive',
    dateLabel: 'Next payment date',
    categories: ['Wages', 'Benefits', 'Side work', 'Support payments', 'Other'],
  },
  expense: {
    noun: 'expense',
    nameLabel: 'What is this expense?',
    placeholder: 'e.g. Rent',
    amountLabel: 'Amount you expect to pay',
    dateLabel: 'Next due date',
    categories: ['Housing', 'Utilities', 'Groceries', 'Insurance', 'Subscriptions', 'Transportation', 'Other'],
  },
  liability: {
    noun: 'liability payment',
    nameLabel: 'What is this payment for?',
    placeholder: 'e.g. Car loan',
    amountLabel: 'Payment amount',
    dateLabel: 'Next payment due date',
    categories: ['Vehicle', 'Student loan', 'Credit card', 'Personal loan', 'Medical', 'Other'],
  },
};

type Freq = RecurrenceRule['type'];

interface RuleState {
  freq: Freq;
  day1: number;
  day2: number;
  interval: string;
  unit: 'day' | 'week' | 'month';
}

function ruleToState(rule: RecurrenceRule, startDate: DateStr | null): RuleState {
  const d = startDate ? parts(startDate).d : 1;
  const base: RuleState = { freq: rule.type, day1: 1, day2: 15, interval: '2', unit: 'week' };
  if (rule.type === 'twiceMonthly') return { ...base, day1: rule.days[0], day2: rule.days[1] };
  if (rule.type === 'custom') return { ...base, interval: String(rule.interval), unit: rule.unit };
  return { ...base, day1: d <= 15 ? d : d - 15, day2: d <= 15 ? Math.min(d + 15, 31) : d };
}

function stateToRule(s: RuleState): RecurrenceRule | string {
  switch (s.freq) {
    case 'twiceMonthly':
      return { type: 'twiceMonthly', days: [s.day1, s.day2] };
    case 'custom': {
      const n = Number(s.interval);
      if (!Number.isInteger(n) || n < 1) return 'Enter how often it repeats as a whole number (1 or more).';
      return { type: 'custom', interval: n, unit: s.unit };
    }
    default:
      return { type: s.freq } as RecurrenceRule;
  }
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function RecurrenceFields({ value, onChange }: { value: RuleState; onChange: (v: RuleState) => void }) {
  return (
    <>
      <Field label="How often?">
        {(p) => (
          <select {...p} value={value.freq} onChange={(e) => onChange({ ...value, freq: e.target.value as Freq })}>
            <option value="weekly">Every week</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="twiceMonthly">Twice a month (two set days)</option>
            <option value="monthly">Once a month</option>
            <option value="custom">Custom</option>
          </select>
        )}
      </Field>
      {value.freq === 'twiceMonthly' && (
        <fieldset className="inline-fields">
          <legend>Which two days of the month?</legend>
          <Field label="First day">
            {(p) => (
              <select {...p} value={value.day1} onChange={(e) => onChange({ ...value, day1: Number(e.target.value) })}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d === 31 ? '31 (or last day)' : d}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Second day">
            {(p) => (
              <select {...p} value={value.day2} onChange={(e) => onChange({ ...value, day2: Number(e.target.value) })}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d >= 29 ? `${d} (or last day)` : d}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </fieldset>
      )}
      {value.freq === 'custom' && (
        <fieldset className="inline-fields">
          <legend>Repeats every</legend>
          <Field label="Number">
            {(p) => <input {...p} type="number" min={1} max={365} inputMode="numeric" value={value.interval} onChange={(e) => onChange({ ...value, interval: e.target.value })} />}
          </Field>
          <Field label="Unit">
            {(p) => (
              <select {...p} value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as RuleState['unit'] })}>
                <option value="day">Days</option>
                <option value="week">Weeks</option>
                <option value="month">Months</option>
              </select>
            )}
          </Field>
        </fieldset>
      )}
      {value.freq === 'monthly' && <p className="hint">Repeats on the same day each month. If a month is shorter, it falls on that month’s last day.</p>}
    </>
  );
}

/** Next generated date of the source on or after today, used as the default effective date for edits. */
export function nextScheduledDate(source: RecurringSource, today: DateStr): DateStr | null {
  const last = source.versions[source.versions.length - 1]!;
  return nextOccurrenceOnOrAfter(last.rule, last.startDate, today);
}

/** Add a new recurring source, or edit an existing one's details and (from an effective date) its schedule. */
export function SourceForm({
  kind,
  source,
  onDone,
  submitLabel,
}: {
  kind: TransactionKind;
  source?: RecurringSource;
  onDone: () => void;
  submitLabel?: string;
}) {
  const { run, today, data } = useStore();
  const toast = useToast();
  const copy = KIND_COPY[kind];
  const current = source?.versions[source.versions.length - 1];
  // Nothing has happened yet for this item, so it can simply be redefined.
  const fresh = !!source && source.active && ops.sourceHasNoHistory(data, source.id, today);
  const defaultStart = source ? (nextScheduledDate(source, today) ?? today) : '';

  const [description, setDescription] = useState(source?.description ?? '');
  const [category, setCategory] = useState(source?.category ?? '');
  const [amount, setAmount] = useState(current ? centsToInput(current.amountCents) : '');
  const [startDate, setStartDate] = useState<DateStr>(defaultStart);
  const [rule, setRule] = useState<RuleState>(() => ruleToState(current?.rule ?? { type: kind === 'income' ? 'biweekly' : 'monthly' }, defaultStart || null));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (description.trim() === '') errs.description = 'Enter a description.';
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0) errs.amount = 'Enter an amount greater than $0, like 1250 or 1250.50.';
    if (!startDate) errs.startDate = 'Choose a date.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    const r = stateToRule(rule);
    if (typeof r === 'string') return setError(r);

    if (!source) {
      const result = run((d, clock) => ops.addSource(d, { kind, description, category, amountCents: cents!, startDate, rule: r }, clock));
      if (!result.ok) return setError(result.error);
      toast(`Added ${description.trim()}.`);
      return onDone();
    }

    if (fresh) {
      const result = run((d, clock) => ops.redefineSource(d, source.id, { description, category, amountCents: cents!, startDate, rule: r }, clock));
      if (!result.ok) return setError(result.error);
      toast(`Saved ${description.trim()}.`);
      return onDone();
    }

    const scheduleChanged =
      source.active &&
      (cents !== current!.amountCents || startDate !== defaultStart || JSON.stringify(r) !== JSON.stringify(current!.rule));
    const result = run((d, clock) => {
      const step = ops.updateSourceDetails(d, source.id, { description, category }, clock);
      if (!step.ok || !scheduleChanged) return step;
      return ops.changeSourceSchedule(step.data, source.id, { startDate, amountCents: cents!, rule: r }, clock);
    });
    if (!result.ok) return setError(result.error);
    toast(scheduleChanged ? `Updated ${description.trim()} starting ${formatMedium(startDate)}.` : `Saved ${description.trim()}.`);
    onDone();
  };

  return (
    <form onSubmit={submit} noValidate className="stack">
      <Field label={copy.nameLabel} error={fieldErrors.description}>
        {(p) => <input {...p} type="text" maxLength={80} placeholder={copy.placeholder} value={description} onChange={(e) => setDescription(e.target.value)} data-autofocus />}
      </Field>
      <Field label="Category (optional)">
        {(p) => (
          <select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">None</option>
            {copy.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
      </Field>
      {source && !source.active && <p className="callout callout-info">This item is turned off. Turn it back on to change its amount or schedule.</p>}
      {source && source.active && !fresh && (
        <p className="callout callout-info">
          Changes to the amount or schedule apply starting on the date below. Earlier transactions and anything you have already recorded keep their original values.
        </p>
      )}
      {(!source || source.active) && (
        <>
      <Field label={copy.amountLabel} error={fieldErrors.amount}>
        {(p) => <MoneyInput {...p} value={amount} onChange={setAmount} />}
      </Field>
      <Field
        label={source && !fresh ? 'Changes start with the payment on' : copy.dateLabel}
        error={fieldErrors.startDate}
        hint={source && !fresh ? `Currently: ${describeRule(current!.rule, current!.startDate)}, ${formatMoney(current!.amountCents)}.` : undefined}
      >
        {(p) => <input {...p} type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
      </Field>
      <RecurrenceFields value={rule} onChange={setRule} />
        </>
      )}
      <FormError message={error} />
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          {submitLabel ?? (source ? 'Save changes' : `Add ${copy.noun}`)}
        </button>
      </div>
    </form>
  );
}

export function OneTimeForm({ kind, onDone }: { kind: 'income' | 'expense'; onDone: () => void }) {
  const { run, today } = useStore();
  const toast = useToast();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<DateStr>(today);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (description.trim() === '') errs.description = 'Enter a description.';
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0) errs.amount = 'Enter an amount greater than $0.';
    if (!date) errs.date = 'Choose a date.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    const result = run((d, clock) => ops.addOneTime(d, { kind, description, amountCents: cents!, date }, clock));
    if (!result.ok) return setError(result.error);
    toast(`Added ${description.trim()} on ${formatMedium(date)}.`);
    onDone();
  };

  return (
    <form onSubmit={submit} noValidate className="stack">
      <p className="hint">This happens once and will not repeat.</p>
      <Field label="Description" error={fieldErrors.description}>
        {(p) => (
          <input {...p} type="text" maxLength={80} placeholder={kind === 'income' ? 'e.g. Tax refund' : 'e.g. Car repair'} value={description} onChange={(e) => setDescription(e.target.value)} data-autofocus />
        )}
      </Field>
      <Field label="Expected amount" error={fieldErrors.amount}>
        {(p) => <MoneyInput {...p} value={amount} onChange={setAmount} />}
      </Field>
      <Field label="Expected date" error={fieldErrors.date}>
        {(p) => <input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      <FormError message={error} />
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          Add one-time {kind}
        </button>
      </div>
    </form>
  );
}

/** Turn an inactive source back on with a new next date. */
export function ReactivateForm({ source, onDone }: { source: RecurringSource; onDone: () => void }) {
  const { run, today } = useStore();
  const toast = useToast();
  const [date, setDate] = useState<DateStr>(today);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = run((d, clock) => ops.reactivateSource(d, source.id, date, clock));
    if (!result.ok) return setError(result.error);
    toast(`${source.description} is back on, starting ${formatMedium(date)}.`);
    onDone();
  };
  return (
    <form onSubmit={submit} noValidate className="stack">
      <Field label="Next expected date" hint="Nothing is added for the time it was turned off.">
        {(p) => <input {...p} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} data-autofocus />}
      </Field>
      <FormError message={error} />
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          Turn back on
        </button>
      </div>
    </form>
  );
}
