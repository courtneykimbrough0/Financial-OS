import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { addDays, formatMedium, formatShort, maxDate, type DateStr } from '../../domain/dates';
import { formatMoney, formatSignedMoney, parseMoney, centsToInput } from '../../domain/money';
import { findOccurrence } from '../../domain/occurrences';
import { applyPreviewedChange, type ProposedChange } from '../../domain/preview';
import {
  applicableChange,
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
import { LIABILITY_TYPE_LABEL, type AppData, type Occurrence, type RecurrenceRule } from '../../domain/types';
import { useStore } from '../../state/store';
import { Field, FormError, Icon, Modal, MoneyInput, SectionLabel, useToast } from './common';
import { GapChanges, Money } from './comparison';

type ChangeType = 'income' | 'expense' | 'payment' | 'liability' | 'reserve' | 'variable';

const TYPES: { type: ChangeType; label: string; hint: string }[] = [
  { type: 'income', label: 'Additional income', hint: 'Money that might come in once' },
  { type: 'expense', label: 'Unexpected expense', hint: 'A cost that might come up once' },
  { type: 'payment', label: 'Change an expected payment', hint: 'Move one, change its amount, or leave it out' },
  { type: 'liability', label: 'Increase a liability payment', hint: 'A higher payment from a date on' },
  { type: 'reserve', label: 'Build reserves', hint: 'An amount saved on a schedule' },
  { type: 'variable', label: 'Explore variable income', hint: 'Low, expected and high amounts' },
];

type Frequency = 'once' | 'weekly' | 'biweekly' | 'monthly';
const FREQUENCY_LABEL: Record<Frequency, string> = { once: 'Once', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };

function typeOf(c: ScenarioChange): ChangeType {
  switch (c.kind) {
    case 'one-time-income':
    case 'hypothetical-income':
      return 'income';
    case 'one-time-expense':
    case 'extra-liability-payment':
      return 'expense';
    case 'occurrence-date':
    case 'occurrence-amount':
    case 'occurrence-skip':
      return 'payment';
    case 'recurring-amount':
      return 'liability';
    case 'recurring-reserve':
      return 'reserve';
  }
}

const scheduleFor = (frequency: Frequency, startDate: DateStr): ScenarioSchedule | null =>
  frequency === 'once' ? null : { startDate, rule: { type: frequency } as RecurrenceRule };

function frequencyOf(schedule: ScenarioSchedule | null): Frequency {
  if (schedule === null) return 'once';
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
    case 'occurrence-skip': {
      const o = occ(c.occurrenceId);
      return `${o?.description ?? 'Payment'} on ${o ? formatMedium(o.scheduledDate) : ''}: left out`;
    }
    case 'recurring-amount':
      return `${data.sources.find((s) => s.id === c.sourceId)?.description ?? 'Payment'}: ${formatMoney(c.amountCents)} from ${formatMedium(c.from)}`;
    case 'recurring-reserve':
      return `${c.description}: ${formatMoney(c.amountCents)} ${FREQUENCY_LABEL[frequencyOf(c.schedule)].toLowerCase()} from ${formatMedium(c.schedule.startDate)}`;
    case 'hypothetical-income':
      return `${c.description}: +${formatMoney(c.amountCents)}`;
    case 'extra-liability-payment':
      return `Extra payment: −${formatMoney(c.amountCents)} on ${formatMedium(c.date)}`;
  }
}

const rangeLabel = (r: IncomeRange) =>
  `${r.description}: ${formatMoney(r.lowCents)} / ${formatMoney(r.expectedCents)} / ${formatMoney(r.highCents)} (low / expected / high), ${r.schedule === null ? `once on ${formatMedium(r.date!)}` : `${FREQUENCY_LABEL[frequencyOf(r.schedule)].toLowerCase()} from ${formatMedium(r.schedule.startDate)}`}`;

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
  const sameOcc = dup((c) => (c.kind === 'occurrence-amount' || c.kind === 'occurrence-date' || c.kind === 'occurrence-skip' ? c.occurrenceId : null));
  if (sameOcc >= 0) return { target: sameOcc, message: error };
  const sameSource = dup((c) => (c.kind === 'recurring-amount' ? c.sourceId : null));
  if (sameSource >= 0) return { target: sameSource, message: error };
  if (changes.length === 1) return { target: 0, message: error };
  if (changes.length === 0 && hasIncome) return { target: 'income', message: error };
  return { target: null, message: error };
}

type Editing = { type: ChangeType; index: number | null };

/** What leaving a payment out means for this kind of item: only the forecast changes. */
function skipNote(o: Pick<Occurrence, 'kind' | 'sourceId'>, data: AppData): string {
  if (o.kind === 'income') return 'Shows your forecast without this income.';
  if (o.kind === 'liability') {
    const type = data.sources.find((s) => s.id === o.sourceId)?.liabilityType;
    const what = type ? LIABILITY_TYPE_LABEL[type].toLowerCase() : 'balance';
    return `This only changes your forecast. Your ${what} and its payments stay the same.`;
  }
  return 'This only changes your forecast.';
}

function describeChange(name: string, change: ProposedChange, from: DateStr, done: boolean): string {
  if (change.kind === 'move') return done ? `Moved ${name} to ${formatMedium(change.date)}.` : `Move ${name} from ${formatMedium(from)} to ${formatMedium(change.date)}.`;
  if (change.kind === 'amount') return done ? `${name} now expected ${formatMoney(change.amountCents)}.` : `Expect ${formatMoney(change.amountCents)} for ${name} on ${formatMedium(from)}.`;
  return done ? `Left ${name} on ${formatMedium(from)} out of your forecast.` : `Leave ${name} on ${formatMedium(from)} out of your forecast.`;
}

/**
 * See what happens if…: one or more hypothetical changes, combined, compared
 * with the forecast as it is. Everything is held on screen only and evaluated
 * by `evaluateScenario` / `evaluateIncomeCases`; nothing is saved, and closing
 * leaves the plan exactly as it was. When the only change is to an expected
 * payment, it can be applied after the person confirms it
 * (`applyPreviewedChange`, which refuses a stale or uncomparable preview).
 *
 * `occurrenceId` opens straight on a change to that payment (from a timing
 * gap); `through` extends the comparison to the period being viewed.
 */
export function ScenarioSheet({ onClose, onApplied, occurrenceId, through }: { onClose: () => void; onApplied?: () => void; occurrenceId?: string; through?: DateStr }) {
  const { data, today, run } = useStore();
  const toast = useToast();
  const [changes, setChanges] = useState<ScenarioChange[]>([]);
  const [income, setIncome] = useState<IncomeRange | null>(null);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(occurrenceId ? { type: 'payment', index: null } : null);
  const [confirming, setConfirming] = useState<{ change: ProposedChange; previewedOn: AppData } | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const opened = occurrenceId ? findOccurrence(data, occurrenceId, today) : null;
  const options = useMemo(() => {
    const o = scenarioOptions(data, today, through ? maxDate(addDays(today, 90), through) : undefined);
    // The payment it was opened on is always offered, even an overdue one that the upcoming list leaves out.
    const first = occurrenceId ? findOccurrence(data, occurrenceId, today) : null;
    if (!first || first.status !== 'scheduled' || o.occurrences.some((x) => x.id === first.id)) return o;
    return { ...o, occurrences: [{ id: first.id, description: first.description, kind: first.kind, date: first.scheduledDate, amountCents: first.scheduledAmountCents }, ...o.occurrences] };
  }, [data, today, through, occurrenceId]);

  // A confirmation is for the changes it was opened on; any edit asks again.
  useEffect(() => setConfirming(null), [changes, income]);

  useEffect(() => {
    if (returnFocus.current && !editing && !picking) {
      returnFocus.current = false;
      addRef.current?.focus();
    }
  }, [editing, picking]);

  const outcome = useMemo(() => {
    const clock = { today, now: `${today}T00:00:00.000Z` };
    if (income) return evaluateIncomeCases(data, changes, income, clock, { through });
    if (changes.length) return evaluateScenario(data, changes, clock, { through });
    return null;
  }, [data, today, changes, income, through]);
  const problem = outcome && !outcome.ok ? attribute(outcome.error, changes, income !== null) : null;
  // Only a single change to an expected payment can be made real, and only when it compares cleanly.
  const proposal = income ? null : applicableChange(changes);
  const canApply = proposal !== null && outcome?.ok === true && 'result' in outcome && outcome.result.comparable;
  const target = proposal ? findOccurrence(data, proposal.occurrenceId, today) : null;

  if (occurrenceId && (!opened || opened.status !== 'scheduled') && changes.length === 0) {
    return (
      <Modal title="See what happens if…" onClose={onClose}>
        <p>This has already been recorded or changed and can't be previewed.</p>
      </Modal>
    );
  }

  const apply = () => {
    if (!confirming || !target) return;
    const r = run((d, clock) => applyPreviewedChange(d, confirming.previewedOn, confirming.change, clock));
    if (!r.ok) {
      setConfirming(null);
      return setApplyError(r.error);
    }
    toast(describeChange(target.description, confirming.change, target.scheduledDate, true));
    (onApplied ?? onClose)();
  };

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
    <Modal title="See what happens if…" onClose={onClose}>
      <div className="stack scenario">
        <p className="hint">Try a change, or several together, and compare with your forecast. Nothing is saved unless you apply a single change.</p>

        {editing ? (
          <ChangeForm
            type={editing.type}
            initial={editing.type === 'variable' ? income : editing.index != null ? changes[editing.index]! : null}
            today={today}
            options={options}
            occurrenceId={occurrenceId}
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
                    disabled={t.type === 'payment' ? options.occurrences.length === 0 : t.type === 'liability' && options.liabilities.length === 0}
                    onClick={() => {
                      setPicking(false);
                      setEditing({ type: t.type, index: null });
                    }}
                  >
                    <span className="entry-title">{t.label}</span>
                    <span className="entry-sub">
                      {t.type === 'liability' && options.liabilities.length === 0 ? 'No liability payments to change' : t.type === 'payment' && options.occurrences.length === 0 ? 'No upcoming payments' : t.hint}
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
                <p className="hint">Add a change to compare.</p>
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
              <button type="button" className={`button ${count === 0 ? 'primary' : 'secondary'}`} ref={addRef} onClick={() => setPicking(true)}>
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
                Fix {changes.length === 1 && !income ? '1 change' : `${changes.length + (income ? 1 : 0)} changes`} to see the comparison.
              </p>
            )}
            {outcome?.ok && 'result' in outcome && <ScenarioComparison r={outcome.result} />}
            {outcome?.ok && 'cases' in outcome && <IncomeCases cases={outcome.cases} />}
            <FormError message={applyError} />
            {canApply && target && proposal && !confirming && (
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setApplyError(null);
                  setConfirming({ change: proposal, previewedOn: data });
                }}
              >
                Apply change…
              </button>
            )}
            {confirming && target && (
              <div className="stack-sm" role="group" aria-labelledby="scenario-confirm">
                <h3 id="scenario-confirm">Apply this change?</h3>
                <p>{describeChange(target.description, confirming.change, target.scheduledDate, false)}</p>
                {confirming.change.kind === 'skip' && <p className="callout callout-info">{skipNote(target, data)}</p>}
                <p className="hint">
                  {target.sourceId ? `Only this one on ${formatMedium(target.scheduledDate)} changes; later ones keep their schedule. ` : ''}
                  This changes your forecast only.
                </p>
                <div className="form-actions">
                  <button type="button" className="button secondary" onClick={() => setConfirming(null)} data-autofocus>
                    Keep exploring
                  </button>
                  <button type="button" className="button primary" onClick={apply}>
                    Apply change
                  </button>
                </div>
              </div>
            )}
            {outcome?.ok && !canApply && changes.length > 1 && changes.some((c) => typeOf(c) === 'payment') && (
              <p className="hint">To apply a change to a payment, make it the only change here.</p>
            )}
          </>
        )}

        {/* Closing is a quiet action; the sheet's own primary action is adding or applying a change. */}
        <p className="center">
          <button type="button" className="button link" onClick={onClose}>
            Done
          </button>
        </p>
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
          {error}
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
  const what = s.created ? <>creates a {amount} timing gap on {formatShort(s.gap.lowestDate)}</> : <>deepens a timing gap to {amount} on {formatShort(s.gap.lowestDate)}</>;
  const recovery = s.gap.recoversOn ? `, back to $0 or more on ${formatShort(s.gap.recoversOn)}` : ", and it doesn't recover within this period";
  const ending = r.differences.endingCents ?? 0;
  return (
    <p className="callout callout-danger scenario-shortfall" role="status">
      {s.despiteGain && ending > 0 ? (
        <>
          Your ending running total improves by <Money cents={ending} />, but this scenario {what}
          {recovery}.
        </>
      ) : s.despiteGain ? (
        <>
          Your cash flow improves by <Money cents={r.differences.netCents} />, but this scenario {what}
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
                !a.inRunningTotal && a.dates.length > 0 ? 'Before the forecast start: cash flow only' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">
        Cash flow from {formatMedium(r.period.start)} through {formatMedium(r.period.end)}
        {r.period.runningTotalFrom ? `; running total from ${formatMedium(r.period.runningTotalFrom)}, starting at $0.` : '.'}
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

const FREQUENCIES: Record<'reserve' | 'variable', Frequency[]> = {
  reserve: ['weekly', 'biweekly', 'monthly'],
  variable: ['once', 'weekly', 'biweekly', 'monthly'],
};

type PaymentAction = 'move' | 'amount' | 'skip';
const PAYMENT_ACTIONS: { action: PaymentAction; label: string }[] = [
  { action: 'move', label: 'Move date' },
  { action: 'amount', label: 'Change amount' },
  { action: 'skip', label: 'Leave it out' },
];

function ChangeForm({
  type,
  initial,
  today,
  options,
  occurrenceId: openedOn,
  onSave,
  onCancel,
}: {
  type: ChangeType;
  initial: ScenarioChange | IncomeRange | null;
  today: DateStr;
  options: ReturnType<typeof scenarioOptions>;
  occurrenceId?: string;
  onSave: (value: ScenarioChange | IncomeRange) => void;
  onCancel: () => void;
}) {
  const { data } = useStore();
  const c = initial && 'kind' in initial ? initial : null;
  const range = initial && !('kind' in initial) ? initial : null;
  const title = TYPES.find((t) => t.type === type)!.label;
  const firstOcc = options.occurrences.find((o) => o.id === openedOn) ?? options.occurrences[0];
  const pillsId = useId();
  const [action, setAction] = useState<PaymentAction>(c?.kind === 'occurrence-amount' ? 'amount' : c?.kind === 'occurrence-skip' ? 'skip' : 'move');
  const firstLiability = options.liabilities[0];

  const [description, setDescription] = useState(
    c && 'description' in c ? c.description : range ? range.description : type === 'income' ? 'Extra income' : type === 'expense' ? 'Unexpected expense' : type === 'reserve' ? 'Reserves' : 'Variable income',
  );
  const [amount, setAmount] = useState(c && 'amountCents' in c ? centsToInput(c.amountCents) : type === 'payment' && firstOcc ? centsToInput(firstOcc.amountCents) : type === 'liability' && firstLiability ? centsToInput(firstLiability.amountCents) : '');
  const [date, setDate] = useState<DateStr>(c && 'date' in c ? c.date : range?.date ?? (c?.kind === 'recurring-reserve' ? c.schedule.startDate : range?.schedule ? range.schedule.startDate : type === 'payment' && firstOcc ? maxDate(firstOcc.date, today) : today));
  const [occurrenceId, setOccurrenceId] = useState(c && 'occurrenceId' in c ? c.occurrenceId : (firstOcc?.id ?? ''));
  const [sourceId, setSourceId] = useState(c?.kind === 'recurring-amount' ? c.sourceId : (firstLiability?.sourceId ?? ''));
  const [from, setFrom] = useState(c?.kind === 'recurring-amount' ? c.from : (firstLiability?.dates[0] ?? ''));
  const [frequency, setFrequency] = useState<Frequency>(c?.kind === 'recurring-reserve' ? frequencyOf(c.schedule) : range ? frequencyOf(range.schedule) : type === 'reserve' ? 'monthly' : 'once');
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
    const needsDate = type === 'income' || type === 'expense' || (type === 'payment' && action === 'move') || type === 'reserve' || type === 'variable';
    if (needsDate && !date) e.date = 'Choose a date.';
    if ((type === 'income' || type === 'expense' || type === 'reserve' || type === 'variable') && !description.trim()) e.description = 'Enter a short name.';
    let value: ScenarioChange | IncomeRange | null = null;
    if (type === 'income') value = { kind: 'one-time-income', description: description.trim(), amountCents: cents(amount, 'amount'), date };
    if (type === 'expense') value = { kind: 'one-time-expense', description: description.trim(), amountCents: cents(amount, 'amount'), date };
    if (type === 'payment' && action === 'move') value = { kind: 'occurrence-date', occurrenceId, date };
    if (type === 'payment' && action === 'amount') value = { kind: 'occurrence-amount', occurrenceId, amountCents: cents(amount, 'amount') };
    if (type === 'payment' && action === 'skip') value = { kind: 'occurrence-skip', occurrenceId };
    if (type === 'liability') value = { kind: 'recurring-amount', sourceId, amountCents: cents(amount, 'amount'), from };
    if (type === 'reserve') value = { kind: 'recurring-reserve', description: description.trim(), amountCents: cents(amount, 'amount'), schedule: scheduleFor(frequency, date)! };
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
      {(type === 'income' || type === 'expense' || type === 'reserve' || type === 'variable') && (
        <Field label="Name" error={errors.description}>
          {(p) => <input {...p} value={description} maxLength={60} onChange={(ev) => setDescription(ev.target.value)} />}
        </Field>
      )}
      {type === 'payment' && (
        <Field label="Payment">
          {(p) => (
            <select
              {...p}
              value={occurrenceId}
              onChange={(ev) => {
                setOccurrenceId(ev.target.value);
                const o = options.occurrences.find((x) => x.id === ev.target.value);
                if (o) {
                  setAmount(centsToInput(o.amountCents));
                  setDate(maxDate(o.date, today));
                }
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
      {type === 'payment' && (
        <fieldset className="choice-field">
          <legend className="sr-only">What to change</legend>
          <div className="choice-pills">
            {PAYMENT_ACTIONS.map((a) => (
              <label key={a.action} className={`choice-pill${action === a.action ? ' selected' : ''}`}>
                <input type="radio" name={`${pillsId}-action`} value={a.action} checked={action === a.action} onChange={() => setAction(a.action)} />
                {a.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {type === 'payment' && action === 'skip' && (() => {
        const o = options.occurrences.find((x) => x.id === occurrenceId);
        const sourceId = o ? (findOccurrence(data, o.id, today)?.sourceId ?? null) : null;
        return o ? <p className="hint">{skipNote({ kind: o.kind, sourceId }, data)}</p> : null;
      })()}
      {!(type === 'payment' && action !== 'amount') && type !== 'variable' && (
        <Field label={type === 'payment' || type === 'liability' ? 'New amount' : type === 'reserve' ? 'Amount each time' : 'Amount'} error={errors.amount}>
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
      {(type === 'reserve' || type === 'variable') && (
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
      {(type === 'income' || type === 'expense' || (type === 'payment' && action === 'move') || type === 'reserve' || type === 'variable') && (
        <Field label={type === 'payment' ? 'New date' : (type === 'reserve' || type === 'variable') && frequency !== 'once' ? 'First date' : 'Date'} error={errors.date}>
          {(p) => <input {...p} type="date" min={today} value={date} onChange={(ev) => setDate(ev.target.value)} />}
        </Field>
      )}
      {type === 'variable' && <p className="hint">Enter amounts you think are possible. They stay hypothetical and aren't added to your forecast.</p>}
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
