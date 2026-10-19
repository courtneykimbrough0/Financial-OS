import { Plus, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { formatMedium, parts, type DateStr } from '../../domain/dates';
import { centsToInput, formatMoney, parseMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import { describeRule, nextOccurrenceOnOrAfter } from '../../domain/recurrence';
import { LIABILITY_TYPE_LABEL, LIABILITY_TYPES, mainPaycheckId, type LiabilityType, type RecurrenceRule, type RecurringKind, type RecurringSource, type TransactionKind } from '../../domain/types';
import { useStore } from '../../state/store';
import { Field, FormError, Icon, MoneyInput, useToast } from './common';
import { AccountSelect } from './money-accounts';
import { useAccountSlot } from '../../state/slots';

export const KIND_COPY: Record<TransactionKind, { noun: string; nameLabel: string; placeholder: string; amountLabel: string; dateLabel: string }> = {
  income: {
    noun: 'income',
    nameLabel: 'What is this income?',
    placeholder: 'e.g. Paycheck from work',
    amountLabel: 'Amount you expect to receive',
    dateLabel: 'Next payment date',
  },
  bill: {
    noun: 'bill',
    nameLabel: 'What is this bill?',
    placeholder: 'e.g. Rent',
    amountLabel: 'Amount you expect to pay',
    dateLabel: 'Next due date',
  },
  subscription: {
    noun: 'subscription',
    nameLabel: 'What is this subscription?',
    placeholder: 'e.g. Streaming service',
    amountLabel: 'Amount you expect to pay',
    dateLabel: 'Next charge date',
  },
  liability: {
    noun: 'liability payment',
    nameLabel: 'What is this payment for?',
    placeholder: 'e.g. Car loan',
    amountLabel: 'Payment amount',
    dateLabel: 'Next payment due date',
  },
  reserve: {
    noun: 'reserve',
    nameLabel: 'What is this reserve for?',
    placeholder: 'e.g. Emergency fund',
    amountLabel: 'Amount you plan to set aside',
    dateLabel: 'Next date you’ll set it aside',
  },
  varied: {
    noun: 'spending',
    nameLabel: 'What is this spending?',
    placeholder: 'e.g. Car repair',
    amountLabel: 'Amount you expect to spend',
    dateLabel: 'Date',
  },
};

/**
 * Optional, user-created tags. Nothing is suggested except tags the user has
 * already made elsewhere in their own data.
 */
export function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const { data } = useStore();
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const mine = ops.allTags(data).filter((t) => !value.some((v) => v.toLowerCase() === t.toLowerCase()));
  const add = (raw: string) => {
    const next = ops.normalizeTags([...value, raw]);
    onChange(next);
    setDraft('');
  };
  const full = value.length >= ops.MAX_TAGS;
  return (
    <div className="field">
      <label htmlFor={inputId}>Tags (optional)</label>
      <p className="hint" id={`${inputId}-hint`}>
        Your own labels for grouping, like a place or a hobby. Press Enter or Add after each one.
      </p>
      {value.length > 0 && (
        <ul className="tag-chips" aria-label="Tags on this item">
          {value.map((t) => (
            <li key={t}>
              <span className="tag">{t}</span>
              <button type="button" className="tag-remove" onClick={() => onChange(value.filter((v) => v !== t))} aria-label={`Remove tag ${t}`}>
                <Icon icon={X} size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="tag-entry">
        <input
          id={inputId}
          type="text"
          value={draft}
          maxLength={ops.MAX_TAG_LENGTH}
          disabled={full}
          aria-describedby={`${inputId}-hint`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (draft.trim()) add(draft);
            }
          }}
        />
        <button type="button" className="button small secondary" disabled={full || !draft.trim()} onClick={() => add(draft)}>
          Add
          <span className="sr-only"> tag</span>
        </button>
      </div>
      {mine.length > 0 && !full && (
        <div className="tag-suggestions">
          <span className="hint">Your tags:</span>
          {mine.slice(0, 12).map((t) => (
            <button key={t} type="button" className="tag tag-button" onClick={() => add(t)}>
              <Icon icon={Plus} size={11} />
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Required choice for liability payments: exactly one of card, loan, or line of credit. */
function LiabilityTypePicker({ value, onChange, error }: { value: LiabilityType | undefined; onChange: (t: LiabilityType) => void; error?: string }) {
  const id = useId();
  return (
    <fieldset className="choice-field" aria-describedby={error ? `${id}-error` : undefined} aria-invalid={error ? true : undefined}>
      <legend>What kind of liability is it?</legend>
      <div className="choice-pills">
        {LIABILITY_TYPES.map((t) => (
          <label key={t} className={`choice-pill${value === t ? ' selected' : ''}`}>
            <input type="radio" name={`${id}-type`} value={t} checked={value === t} onChange={() => onChange(t)} />
            {LIABILITY_TYPE_LABEL[t]}
          </label>
        ))}
      </div>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

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
  kind: RecurringKind;
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
  const [tags, setTags] = useState<string[]>(source?.tags ?? []);
  const [liabilityType, setLiabilityType] = useState<LiabilityType | undefined>(source?.liabilityType);
  const [accountId, setAccountId] = useState<string | null>(source?.accountId ?? null);
  const [amount, setAmount] = useState(current ? centsToInput(current.amountCents) : '');
  const [startDate, setStartDate] = useState<DateStr>(defaultStart);
  const [rule, setRule] = useState<RuleState>(() => ruleToState(current?.rule ?? { type: kind === 'income' ? 'biweekly' : 'monthly' }, defaultStart || null));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (description.trim() === '') errs.description = 'Enter a description.';
    if (kind === 'liability' && !liabilityType) errs.liabilityType = 'Choose card, loan, or line of credit.';
    const cents = parseMoney(amount);
    if (cents === null || cents <= 0) errs.amount = 'Enter an amount greater than $0, like 1250 or 1250.50.';
    if (!startDate) errs.startDate = 'Choose a date.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    const r = stateToRule(rule);
    if (typeof r === 'string') return setError(r);

    // The account choice is optional and changes nothing in the forecast; it's applied with the rest in one step.
    const withAccount = (step: ops.Result, id: string, clock: ops.Clock): ops.Result => (step.ok ? ops.assignAccount(step.data, id, accountId, clock) : step);

    if (!source) {
      const id = ops.newId('src');
      const result = run((d, clock) => withAccount(ops.addSource(d, { kind, description, tags, liabilityType, amountCents: cents!, startDate, rule: r }, clock, id), id, clock));
      if (!result.ok) return setError(result.error);
      toast(`Added ${description.trim()}.`);
      return onDone();
    }

    if (fresh) {
      const result = run((d, clock) => withAccount(ops.redefineSource(d, source.id, { description, tags, liabilityType, amountCents: cents!, startDate, rule: r }, clock), source.id, clock));
      if (!result.ok) return setError(result.error);
      toast(`Saved ${description.trim()}.`);
      return onDone();
    }

    const scheduleChanged =
      source.active &&
      (cents !== current!.amountCents || startDate !== defaultStart || JSON.stringify(r) !== JSON.stringify(current!.rule));
    const result = run((d, clock) => {
      const step = withAccount(ops.updateSourceDetails(d, source.id, { description, tags, liabilityType }, clock), source.id, clock);
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
      {kind === 'liability' && (
        <LiabilityTypePicker
          value={liabilityType}
          onChange={(t) => {
            setLiabilityType(t);
            setFieldErrors(({ liabilityType: _cleared, ...rest }) => rest);
          }}
          error={fieldErrors.liabilityType}
        />
      )}
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
      <AccountSelect kind={kind} value={accountId} onChange={setAccountId} />
      <TagInput value={tags} onChange={setTags} />
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

const ONE_TIME_PLACEHOLDER: Record<ops.OneTimeInput['kind'], string> = { income: 'e.g. Tax refund', reserve: 'e.g. Bonus set aside', varied: 'e.g. Car repair' };

export function OneTimeForm({ kind, onDone }: { kind: ops.OneTimeInput['kind']; onDone: () => void }) {
  const { run, today } = useStore();
  const toast = useToast();
  const id = useId();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<DateStr>(today);
  const [tags, setTags] = useState<string[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [release, setRelease] = useState(false);
  // The Supabase development build can't store releases yet (it refuses the save), so it doesn't offer them.
  const canRelease = kind === 'reserve' && !useAccountSlot();
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
    const itemId = ops.newId('one');
    const result = run((d, clock) => {
      const step = ops.addOneTime(d, { kind, description, tags, amountCents: cents!, date, release }, clock, itemId);
      return step.ok ? ops.assignAccount(step.data, itemId, accountId, clock) : step;
    });
    if (!result.ok) return setError(result.error);
    toast(`Added ${description.trim()} on ${formatMedium(date)}.`);
    onDone();
  };

  return (
    <form onSubmit={submit} noValidate className="stack">
      <p className="hint">This happens once and will not repeat.</p>
      {canRelease && (
        <fieldset className="choice-field">
          <legend className="sr-only">Set aside or use</legend>
          <div className="choice-pills">
            {[
              [false, 'Set aside'],
              [true, 'Use reserves'],
            ].map(([value, label]) => (
              <label key={String(value)} className={`choice-pill${release === value ? ' selected' : ''}`}>
                <input type="radio" name={`${id}-release`} checked={release === value} onChange={() => setRelease(value as boolean)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="Description" error={fieldErrors.description}>
        {(p) => <input {...p} type="text" maxLength={80} placeholder={release ? 'e.g. Toward the car repair' : ONE_TIME_PLACEHOLDER[kind]} value={description} onChange={(e) => setDescription(e.target.value)} data-autofocus />}
      </Field>
      <Field label="Expected amount" error={fieldErrors.amount}>
        {(p) => <MoneyInput {...p} value={amount} onChange={setAmount} />}
      </Field>
      <Field label="Expected date" error={fieldErrors.date}>
        {(p) => <input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      <AccountSelect kind={kind} value={accountId} onChange={setAccountId} />
      <TagInput value={tags} onChange={setTags} />
      <FormError message={error} />
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          {kind === 'varied' ? 'Add spending' : release ? 'Add release' : `Add one-time ${KIND_COPY[kind].noun}`}
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

/**
 * Which income starts pay periods. Shown once there are two or more active
 * recurring incomes; with one, that income is the main paycheck.
 */
export function MainPaycheckPicker() {
  const { data, run } = useStore();
  const toast = useToast();
  const id = useId();
  const incomes = data.sources.filter((s) => s.kind === 'income' && s.active);
  const main = mainPaycheckId(data);
  if (incomes.length < 2) return null;
  return (
    <fieldset className="choice-field main-paycheck" aria-describedby={`${id}-hint`}>
      <legend>Main paycheck</legend>
      <p className="hint" id={`${id}-hint`}>
        Pay periods run from one main payday to the next. Other income still counts as money coming in during the pay period.
      </p>
      <div className="choice-pills">
        {incomes.map((s) => (
          <label key={s.id} className={`choice-pill${main === s.id ? ' selected' : ''}`}>
            <input
              type="radio"
              name={`${id}-main`}
              value={s.id}
              checked={main === s.id}
              onChange={() => {
                const r = run((d, c) => ops.setMainPaycheck(d, s.id, c));
                if (r.ok) toast(`Pay periods now follow ${s.description}.`);
                else toast(r.error, 'error');
              }}
            />
            {s.description}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
