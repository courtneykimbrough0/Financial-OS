import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatMedium, formatShort, type DateStr } from '../../domain/dates';
import { formatMoney, formatSignedMoney, parseMoney, centsToInput } from '../../domain/money';
import { findOccurrence } from '../../domain/occurrences';
import {
  evaluateIncomeCases,
  evaluateScenario,
  firstShortfall,
  scenarioOptions,
  type IncomeCaseName,
  type IncomeRange,
  type ScenarioChange,
  type ScenarioResult,
  type ScenarioSchedule,
} from '../../domain/scenarios';
import type { AppData, RecurrenceRule } from '../../domain/types';
import { useStore } from '../../state/store';
import { Field, Icon, Modal, MoneyInput, SectionLabel } from './common';
import { GapChanges, Money } from './comparison';

type ChangeType = 'income' | 'expense' | 'move' | 'amount' | 'liability' | 'savings' | 'variable';

const TYPES: { type: ChangeType; label: string; hint: string }[] = [
  { type: 'income', label: 'Additional income', hint: 'Money that might come in once' },
  { type: 'expense', label: 'Unexpected expense', hint: 'A cost that might come up once' },
  { type: 'move', label: 'Move an expected payment', hint: 'One upcoming payment on another date' },
  { type: 'amount', label: 'Change an expected amount', hint: 'One upcoming payment at another amount' },
  { type: 'liability', label: 'Increase a liability payment', hint: 'A higher payment from a date on' },
  { type: 'savings', label: 'Set aside savings', hint: 'An amount on a schedule' },
  { type: 'variable', label: 'Explore variable income', hint: 'Low, expected and high amounts' },
];

type Frequency = 'once' | 'paycheck' | 'weekly' | 'biweekly' | 'monthly';
const FREQUENCY_LABEL: Record<Frequency, string> = { once: 'Once', paycheck: 'Each payday', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };

function typeOf(c: ScenarioChange): ChangeType {
  switch (c.kind) {
    case 'one-time-income':
    case 'hypothetical-income':
      return 'income';
    case 'one-time-expense':
    case 'extra-liability-payment':
      return 'expense';
    case 'occurrence-date':
      return 'move';
    case 'occurrence-amount':
      return 'amount';
    case 'recurring-amount':
      return 'liability';
    case 'recurring-savings':
      return 'savings';
  }
}

const scheduleFor = (frequency: Frequency, startDate: DateStr): ScenarioSchedule | null =>
  frequency === 'once' ? null : frequency === 'paycheck' ? 'each-paycheck' : { startDate, rule: { type: frequency } as RecurrenceRule };

function frequencyOf(schedule: ScenarioSchedule | null): Frequency {
  if (schedule === null) return 'once';
  if (schedule === 'each-paycheck') return 'paycheck';
  return schedule.rule.type === 'weekly' || schedule.rule.type === 'biweekly' ? schedule.rule.type : 'monthly';
}

/** A short line for one of the person's changes, from what they entered. */
function changeLabel(c: ScenarioChange, data: AppData, today: DateStr): string {
  const occ = (id: string) => findOccurrence(data, id, today);
  switch (c.kind) {
    case 'one-time-income':
      return `${c.description}: +${formatMoney(c.amountCents)} on ${formatMedium(c.date)}`;
    case 'one-time-expense':
      return `${c.description}: −${formatMoney(c.amountCents)} on ${formatMedium(c.date)}`;
    case 'occurrence-date': {
      const o = occ(c.occurrenceId);
      return `${o?.description ?? 'Payment'} on ${o ? formatMedium(o.scheduledDate) : ''}: move to ${formatMedium(c.date)}`;
    }
    case 'occurrence-amount': {
      const o = occ(c.occurrenceId);
      return `${o?.description ?? 'Payment'} on ${o ? formatMedium(o.scheduledDate) : ''}: ${formatMoney(c.amountCents)}`;
    }
    case 'recurring-amount':
      return `${data.sources.find((s) => s.id === c.sourceId)?.description ?? 'Payment'}: ${formatMoney(c.amountCents)} from ${formatMedium(c.from)}`;
    case 'recurring-savings':
      return `${c.description}: ${formatMoney(c.amountCents)} ${c.schedule === 'each-paycheck' ? 'each payday' : `${FREQUENCY_LABEL[frequencyOf(c.schedule)].toLowerCase()} from ${formatMedium(c.schedule.startDate)}`}`;
    case 'hypothetical-income':
      return `${c.description}: +${formatMoney(c.amountCents)}`;
    case 'extra-liability-payment':
      return `Extra payment: −${formatMoney(c.amountCents)} on ${formatMedium(c.date)}`;
  }
}

const rangeLabel = (r: IncomeRange) =>
  `${r.description}: ${formatMoney(r.lowCents)} / ${formatMoney(r.expectedCents)} / ${formatMoney(r.highCents)} (low / expected / high), ${r.schedule === null ? `once on ${formatMedium(r.date!)}` : r.schedule === 'each-paycheck' ? 'each payday' : `${FREQUENCY_LABEL[frequencyOf(r.schedule)].toLowerCase()} from ${formatMedium(r.schedule.startDate)}`}`;

const RANGE_ERRORS = ['Enter each income case', 'The low case', 'Enter an expected and high', 'Choose the date the income'];

/** Which of the person's changes an engine error is about: an index, 'income', or null for the scenario as a whole. */
function attribute(error: string, changes: ScenarioChange[], hasIncome: boolean): { target: number | 'income' | null; message: string } {
  const m = /^Change (\d+): (.*)$/.exec(error);
  if (m) {
    const i = Number(m[1]) - 1;
    return { target: i < changes.length ? i : 'income', message: m[2]! };
  }
  if (hasIncome && RANGE_ERRORS.some((p) => error.startsWith(p))) return { target: 'income', message: error };
  const dup = (key: (c: ScenarioChange) => string | null) => changes.findIndex((c, i) => key(c) !== null && changes.slice(0, i).some((d) => key(d) === key(c)));
  const sameOcc = dup((c) => (c.kind === 'occurrence-amount' || c.kind === 'occurrence-date' ? c.occurrenceId : null));
  if (sameOcc >= 0) return { target: sameOcc, message: error };
  const sameSource = dup((c) => (c.kind === 'recurring-amount' ? c.sourceId : null));
  if (sameSource >= 0) return { target: sameSource, message: error };
  if (changes.length === 1) return { target: 0, message: error };
  if (changes.length === 0 && hasIncome) return { target: 'income', message: error };
  return { target: null, message: error };
}

type Editing = { type: ChangeType; index: number | null };

/**
 * Explore a scenario: a few hypothetical changes, combined, compared with
 * the forecast as it is. Everything is held on screen only and evaluated by
 * `evaluateScenario` / `evaluateIncomeCases`; nothing is saved, and closing
 * leaves the plan exactly as it was.
 */
export function ScenarioSheet({ onClose }: { onClose: () => void }) {
  const { data, today } = useStore();
  const [changes, setChanges] = useState<ScenarioChange[]>([]);
  const [income, setIncome] = useState<IncomeRange | null>(null);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const options = useMemo(() => scenarioOptions(data, today), [data, today]);

  useEffect(() => {
    if (returnFocus.current && !editing && !picking) {
      returnFocus.current = false;
      addRef.current?.focus();
    }
  }, [editing, picking]);

  const outcome = useMemo(() => {
    const clock = { today, now: `${today}T00:00:00.000Z` };
    if (income) return evaluateIncomeCases(data, changes, income, clock);
    if (changes.length) return evaluateScenario(data, changes, clock);
    return null;
  }, [data, today, changes, income]);
  const problem = outcome && !outcome.ok ? attribute(outcome.error, changes, income !== null) : null;

  const close = () => {
    returnFocus.current = true;
    setEditing(null);
    setPicking(false);
  };
  const save = (value: ScenarioChange | IncomeRange) => {
    if (editing?.type === 'variable') setIncome(value as IncomeRange);
    else if (editing?.index != null) setChanges(changes.map((c, i) => (i === editing.index ? (value as ScenarioChange) : c)));
    else setChanges([...changes, value as ScenarioChange]);
    close();
  };

  const count = changes.length + (income ? 1 : 0);

  return (
    <Modal title="Explore a scenario" onClose={onClose}>
      <div className="stack scenario">
        <p className="hint">Try a few what-ifs together and compare them with your forecast. Nothing here changes your plan or is saved.</p>

        {editing ? (
          <ChangeForm
            type={editing.type}
            initial={editing.type === 'variable' ? income : editing.index != null ? changes[editing.index]! : null}
            today={today}
            options={options}
            onSave={save}
            onCancel={close}
          />
        ) : picking ? (
          <section className="stack-sm" aria-label="Choose a change" ref={(el) => el?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()}>
            <SectionLabel>What might happen?</SectionLabel>
            <ul className="scenario-types">
              {TYPES.filter((t) => !(t.type === 'variable' && income)).map((t) => (
                <li key={t.type}>
                  <button
                    type="button"
                    className="scenario-type"
                    disabled={(t.type === 'move' || t.type === 'amount') && options.occurrences.length === 0 ? true : t.type === 'liability' && options.liabilities.length === 0}
                    onClick={() => {
                      setPicking(false);
                      setEditing({ type: t.type, index: null });
                    }}
                  >
                    <span className="entry-title">{t.label}</span>
                    <span className="entry-sub">
                      {t.type === 'liability' && options.liabilities.length === 0 ? 'No liability payments to change' : (t.type === 'move' || t.type === 'amount') && options.occurrences.length === 0 ? 'No upcoming payments' : t.hint}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={close}>
                Cancel
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="stack-sm" aria-label="Your changes">
              <SectionLabel>Your changes</SectionLabel>
              {count === 0 ? (
                <p className="hint">No changes yet. Add one to see how it would affect your forecast.</p>
              ) : (
                <ul className="scenario-changes">
                  {changes.map((c, i) => (
                    <ChangeRow
                      key={i}
                      label={changeLabel(c, data, today)}
                      error={problem?.target === i ? problem.message : null}
                      onEdit={() => setEditing({ type: typeOf(c), index: i })}
                      onRemove={() => {
                        returnFocus.current = true;
                        setChanges(changes.filter((_, j) => j !== i));
                      }}
                    />
                  ))}
                  {income && (
                    <ChangeRow
                      label={rangeLabel(income)}
                      error={problem?.target === 'income' ? problem.message : null}
                      onEdit={() => setEditing({ type: 'variable', index: null })}
                      onRemove={() => {
                        returnFocus.current = true;
                        setIncome(null);
                      }}
                    />
                  )}
                </ul>
              )}
              <button type="button" className="button secondary" ref={addRef} onClick={() => setPicking(true)}>
                <Icon icon={Plus} size={16} /> Add a change
              </button>
            </section>

            {problem && problem.target === null && (
              <p className="field-error" role="alert">
                {problem.message}
              </p>
            )}
            {problem && problem.target !== null && (
              <p className="field-error" role="alert">
                One change needs attention before the scenario can be compared.
              </p>
            )}
            {outcome?.ok && 'result' in outcome && <ScenarioComparison r={outcome.result} />}
            {outcome?.ok && 'cases' in outcome && <IncomeCases cases={outcome.cases} />}
          </>
        )}

        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ChangeRow({ label, error, onEdit, onRemove }: { label: string; error: string | null; onEdit: () => void; onRemove: () => void }) {
  const id = useId();
  return (
    <li className={`scenario-change${error ? ' invalid' : ''}`} aria-describedby={error ? id : undefined}>
      <span className="scenario-change-label">{label}</span>
      <span className="scenario-change-actions">
        <button type="button" className="icon-button" onClick={onEdit} aria-label={`Edit ${label}`}>
          <Icon icon={Pencil} size={18} />
        </button>
        <button type="button" className="icon-button" onClick={onRemove} aria-label={`Remove ${label}`}>
          <Icon icon={Trash2} size={18} />
        </button>
      </span>
      {error && (
        <p className="field-error scenario-change-error" id={id}>
          Needs attention: {error}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function ShortfallNote({ r }: { r: ScenarioResult }) {
  const s = firstShortfall(r);
  if (!s) return null;
  const amount = <Money cents={Math.abs(s.gap.lowestCents)} />;
  const what = s.created ? <>creates a {amount} shortfall on {formatShort(s.gap.lowestDate)}</> : <>deepens a shortfall to {amount} on {formatShort(s.gap.lowestDate)}</>;
  const recovery = s.gap.recoversOn ? `, back to $0 or more on ${formatShort(s.gap.recoversOn)}` : ', and it doesn’t recover within this period';
  const ending = r.differences.endingCents ?? 0;
  return (
    <p className="callout callout-danger scenario-shortfall" role="status">
      {s.despiteGain && ending > 0 ? (
        <>
          Your projected ending total improves by <Money cents={ending} />, but this scenario {what}
          {recovery}.
        </>
      ) : s.despiteGain ? (
        <>
          Your projected cash flow improves by <Money cents={r.differences.netCents} />, but this scenario {what}
          {recovery}.
        </>
      ) : (
        <>
          This scenario {what}
          {recovery}.
        </>
      )}
    </p>
  );
}

const lowLine = (o: ScenarioResult['baseline']) => (o.lowest ? <><Money cents={o.lowest.tallyCents} /> on {formatShort(o.lowest.date)}</> : '—');
const gapsLine = (n: number) => (n === 0 ? 'None' : n === 1 ? '1' : String(n));

function ScenarioComparison({ r }: { r: ScenarioResult }) {
  const hyp = r.scenario.cashFlow.hypotheticalIncomeCents;
  return (
    <section className="stack-sm" aria-label="Scenario comparison">
      <SectionLabel>Compared with your forecast</SectionLabel>
      <ShortfallNote r={r} />
      {r.limitations.map((l) => (
        <p key={l} className="callout callout-info">
          {l}
        </p>
      ))}
      <table className="scenario-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col">Current forecast</th>
            <th scope="col">With this scenario</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Cash flow</th>
            <td>{formatSignedMoney(r.baseline.cashFlow.netCents)}</td>
            <td>{formatSignedMoney(r.scenario.cashFlow.netCents)}</td>
          </tr>
          {r.comparable && (
            <>
              <tr>
                <th scope="row">Lowest running total</th>
                <td>{lowLine(r.baseline)}</td>
                <td>{lowLine(r.scenario)}</td>
              </tr>
              <tr>
                <th scope="row">Ending running total</th>
                <td>{r.baseline.endingCents === null ? '—' : <Money cents={r.baseline.endingCents} />}</td>
                <td>{r.scenario.endingCents === null ? '—' : <Money cents={r.scenario.endingCents} />}</td>
              </tr>
              <tr>
                <th scope="row">Timing gaps</th>
                <td>{gapsLine(r.baseline.gaps.length)}</td>
                <td>{gapsLine(r.scenario.gaps.length)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      {hyp > 0 && (
        <p className="hint">
          Includes <Money cents={hyp} /> of hypothetical income. Without it, cash flow would be {formatSignedMoney(r.scenario.cashFlow.netWithoutHypotheticalCents)}.
        </p>
      )}
      {r.comparable && <GapChanges newGaps={r.newGaps} worsenedGaps={r.worsenedGaps} reducedGaps={r.reducedGaps} resolvedGaps={r.resolvedGaps} proposedGaps={r.scenario.gaps} />}
      <Assumptions r={r} />
    </section>
  );
}

function Assumptions({ r }: { r: ScenarioResult }) {
  return (
    <section className="stack-sm" aria-label="What this assumes">
      <SectionLabel>What this assumes</SectionLabel>
      <ul className="scenario-assumptions">
        {r.assumptions.map((a, i) => (
          <li key={i}>
            <span>{a.label}</span>
            <span className="hint">
              {[
                a.recurrence === 'one-time' ? 'One-time' : 'Recurring',
                a.income === 'hypothetical' ? 'Hypothetical income, not in your forecast' : a.income === 'confirmed' ? 'Income you entered' : null,
                a.recurrence === 'recurring' && a.dates.length > 0 ? `Dates in this period: ${a.dates.map(formatShort).join(', ')}` : null,
                !a.inRunningTotal && a.dates.length > 0 ? 'Before your next payday: cash flow only' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">
        Cash flow from {formatMedium(r.period.start)} through {formatMedium(r.period.end)}
        {r.period.runningTotalFrom ? `; running total from ${formatMedium(r.period.runningTotalFrom)}, the day of your next payday.` : '.'} The running total shows timing, separate from your bank balance.
      </p>
    </section>
  );
}

const CASES: { name: IncomeCaseName; label: string }[] = [
  { name: 'low', label: 'Low' },
  { name: 'expected', label: 'Expected' },
  { name: 'high', label: 'High' },
];

function IncomeCases({ cases }: { cases: Record<IncomeCaseName, ScenarioResult> }) {
  const [shown, setShown] = useState<IncomeCaseName>('expected');
  const name = useId();
  const comparable = cases.expected.comparable;
  return (
    <section className="stack-sm" aria-label="Income cases">
      <SectionLabel>Three income cases</SectionLabel>
      <p className="hint">All three are hypothetical. None is added to your forecast.</p>
      <table className="scenario-table scenario-cases">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Measure</span>
            </th>
            {CASES.map((c) => (
              <th scope="col" key={c.name}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Hypothetical income</th>
            {CASES.map((c) => (
              <td key={c.name}>
                <Money cents={cases[c.name].scenario.cashFlow.hypotheticalIncomeCents} />
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Cash flow</th>
            {CASES.map((c) => (
              <td key={c.name}>{formatSignedMoney(cases[c.name].scenario.cashFlow.netCents)}</td>
            ))}
          </tr>
          {comparable && (
            <>
              <tr>
                <th scope="row">Lowest running total</th>
                {CASES.map((c) => (
                  <td key={c.name}>{lowLine(cases[c.name].scenario)}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Timing gaps</th>
                {CASES.map((c) => (
                  <td key={c.name}>{gapsLine(cases[c.name].scenario.gaps.length)}</td>
                ))}
              </tr>
            </>
          )}
        </tbody>
      </table>
      <fieldset className="choice-field">
        <legend>Details for</legend>
        <div className="choice-pills">
          {CASES.map((c) => (
            <label key={c.name} className={`choice-pill${shown === c.name ? ' selected' : ''}`}>
              <input type="radio" name={name} value={c.name} checked={shown === c.name} onChange={() => setShown(c.name)} />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <ScenarioComparison r={cases[shown]} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Entering a change
// ---------------------------------------------------------------------------

const FREQUENCIES: Record<'savings' | 'variable', Frequency[]> = {
  savings: ['paycheck', 'weekly', 'biweekly', 'monthly'],
  variable: ['once', 'weekly', 'biweekly', 'monthly'],
};

function ChangeForm({
  type,
  initial,
  today,
  options,
  onSave,
  onCancel,
}: {
  type: ChangeType;
  initial: ScenarioChange | IncomeRange | null;
  today: DateStr;
  options: ReturnType<typeof scenarioOptions>;
  onSave: (value: ScenarioChange | IncomeRange) => void;
  onCancel: () => void;
}) {
  const c = initial && 'kind' in initial ? initial : null;
  const range = initial && !('kind' in initial) ? initial : null;
  const title = TYPES.find((t) => t.type === type)!.label;
  const firstOcc = options.occurrences[0];
  const firstLiability = options.liabilities[0];

  const [description, setDescription] = useState(
    c && 'description' in c ? c.description : range ? range.description : type === 'income' ? 'Extra income' : type === 'expense' ? 'Unexpected expense' : type === 'savings' ? 'Savings' : 'Variable income',
  );
  const [amount, setAmount] = useState(c && 'amountCents' in c ? centsToInput(c.amountCents) : type === 'amount' && firstOcc ? centsToInput(firstOcc.amountCents) : type === 'liability' && firstLiability ? centsToInput(firstLiability.amountCents) : '');
  const [date, setDate] = useState<DateStr>(c && 'date' in c ? c.date : range?.date ?? (c?.kind === 'recurring-savings' && c.schedule !== 'each-paycheck' ? c.schedule.startDate : range && range.schedule && range.schedule !== 'each-paycheck' ? range.schedule.startDate : type === 'move' && firstOcc ? firstOcc.date : today));
  const [occurrenceId, setOccurrenceId] = useState(c && 'occurrenceId' in c ? c.occurrenceId : (firstOcc?.id ?? ''));
  const [sourceId, setSourceId] = useState(c?.kind === 'recurring-amount' ? c.sourceId : (firstLiability?.sourceId ?? ''));
  const [from, setFrom] = useState(c?.kind === 'recurring-amount' ? c.from : (firstLiability?.dates[0] ?? ''));
  const [frequency, setFrequency] = useState<Frequency>(c?.kind === 'recurring-savings' ? frequencyOf(c.schedule) : range ? frequencyOf(range.schedule) : type === 'savings' ? 'paycheck' : 'once');
  const [low, setLow] = useState(range ? centsToInput(range.lowCents) : '');
  const [expected, setExpected] = useState(range ? centsToInput(range.expectedCents) : '');
  const [high, setHigh] = useState(range ? centsToInput(range.highCents) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const liability = options.liabilities.find((l) => l.sourceId === sourceId);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => formRef.current?.querySelector<HTMLElement>('input, select')?.focus(), []);

  const submit = () => {
    const e: Record<string, string> = {};
    const cents = (value: string, key: string, allowZero = false) => {
      const v = parseMoney(value);
      if (v === null || v < 0 || (!allowZero && v === 0)) e[key] = allowZero ? 'Enter $0 or more.' : 'Enter an amount above $0.';
      return v ?? 0;
    };
    const needsDate = type === 'income' || type === 'expense' || type === 'move' || ((type === 'savings' || type === 'variable') && frequency !== 'paycheck');
    if (needsDate && !date) e.date = 'Choose a date.';
    if ((type === 'income' || type === 'expense' || type === 'savings' || type === 'variable') && !description.trim()) e.description = 'Enter a short name.';
    let value: ScenarioChange | IncomeRange | null = null;
    if (type === 'income') value = { kind: 'one-time-income', description: description.trim(), amountCents: cents(amount, 'amount'), date };
    if (type === 'expense') value = { kind: 'one-time-expense', description: description.trim(), amountCents: cents(amount, 'amount'), date };
    if (type === 'move') value = { kind: 'occurrence-date', occurrenceId, date };
    if (type === 'amount') value = { kind: 'occurrence-amount', occurrenceId, amountCents: cents(amount, 'amount') };
    if (type === 'liability') value = { kind: 'recurring-amount', sourceId, amountCents: cents(amount, 'amount'), from };
    if (type === 'savings') value = { kind: 'recurring-savings', description: description.trim(), amountCents: cents(amount, 'amount'), schedule: scheduleFor(frequency, date)! };
    if (type === 'variable') {
      const schedule = scheduleFor(frequency, date);
      value = { description: description.trim(), schedule, ...(schedule === null ? { date } : {}), lowCents: cents(low, 'low', true), expectedCents: cents(expected, 'expected'), highCents: cents(high, 'high') };
    }
    setErrors(e);
    if (Object.keys(e).length === 0 && value) onSave(value);
  };

  const occLabel = (o: (typeof options.occurrences)[number]) => `${o.description} · ${formatMedium(o.date)} · ${formatMoney(o.amountCents)}`;

  return (
    <form
      ref={formRef}
      className="stack-sm"
      aria-label={title}
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        submit();
      }}
    >
      <h3>{title}</h3>
      {(type === 'income' || type === 'expense' || type === 'savings' || type === 'variable') && (
        <Field label="Name" error={errors.description}>
          {(p) => <input {...p} value={description} maxLength={60} onChange={(ev) => setDescription(ev.target.value)} />}
        </Field>
      )}
      {(type === 'move' || type === 'amount') && (
        <Field label="Payment">
          {(p) => (
            <select
              {...p}
              value={occurrenceId}
              onChange={(ev) => {
                setOccurrenceId(ev.target.value);
                const o = options.occurrences.find((x) => x.id === ev.target.value);
                if (o && type === 'amount') setAmount(centsToInput(o.amountCents));
                if (o && type === 'move') setDate(o.date);
              }}
            >
              {options.occurrences.map((o) => (
                <option key={o.id} value={o.id}>
                  {occLabel(o)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {type === 'liability' && (
        <>
          <Field label="Liability payment">
            {(p) => (
              <select
                {...p}
                value={sourceId}
                onChange={(ev) => {
                  const l = options.liabilities.find((x) => x.sourceId === ev.target.value);
                  setSourceId(ev.target.value);
                  if (l) {
                    setAmount(centsToInput(l.amountCents));
                    setFrom(l.dates[0]!);
                  }
                }}
              >
                {options.liabilities.map((l) => (
                  <option key={l.sourceId} value={l.sourceId}>
                    {l.description} · {formatMoney(l.amountCents)} now
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Starting with">
            {(p) => (
              <select {...p} value={from} onChange={(ev) => setFrom(ev.target.value)}>
                {(liability?.dates ?? []).map((d) => (
                  <option key={d} value={d}>
                    {formatMedium(d)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
      {type !== 'move' && type !== 'variable' && (
        <Field label={type === 'amount' || type === 'liability' ? 'New amount' : type === 'savings' ? 'Amount each time' : 'Amount'} error={errors.amount}>
          {(p) => <MoneyInput {...p} value={amount} onChange={setAmount} />}
        </Field>
      )}
      {type === 'variable' && (
        <div className="scenario-cases-inputs">
          <Field label="Low" error={errors.low}>
            {(p) => <MoneyInput {...p} value={low} onChange={setLow} />}
          </Field>
          <Field label="Expected" error={errors.expected}>
            {(p) => <MoneyInput {...p} value={expected} onChange={setExpected} />}
          </Field>
          <Field label="High" error={errors.high}>
            {(p) => <MoneyInput {...p} value={high} onChange={setHigh} />}
          </Field>
        </div>
      )}
      {(type === 'savings' || type === 'variable') && (
        <Field label="How often">
          {(p) => (
            <select {...p} value={frequency} onChange={(ev) => setFrequency(ev.target.value as Frequency)}>
              {FREQUENCIES[type].map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {(type === 'income' || type === 'expense' || type === 'move' || ((type === 'savings' || type === 'variable') && frequency !== 'paycheck')) && (
        <Field label={type === 'move' ? 'New date' : (type === 'savings' || type === 'variable') && frequency !== 'once' ? 'First date' : 'Date'} error={errors.date}>
          {(p) => <input {...p} type="date" min={today} value={date} onChange={(ev) => setDate(ev.target.value)} />}
        </Field>
      )}
      {type === 'variable' && <p className="hint">Enter amounts you think are possible. They stay hypothetical and aren’t added to your forecast.</p>}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button primary">
          {initial ? 'Save change' : 'Add to scenario'}
        </button>
      </div>
    </form>
  );
}
