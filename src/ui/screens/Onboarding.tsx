import { useEffect, useRef, useState } from 'react';
import { formatMedium } from '../../domain/dates';
import { buildForecast, dailyTimeline, lowestPoint, paycheckCycles } from '../../domain/forecast';
import { formatMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import { describeRule } from '../../domain/recurrence';
import type { RecurringSource, TransactionKind } from '../../domain/types';
import { useStore } from '../../state/store';
import { FlowAmount, useToast } from '../components/common';
import { SourceForm } from '../components/forms';
import { navigate } from '../router';

const STEPS = ['Welcome', 'Income', 'Expenses', 'Liabilities', 'Review'] as const;

const STEP_COPY: Record<TransactionKind, { title: string; body: string; add: string; addAnother: string }> = {
  income: {
    title: 'When does money come in?',
    body: 'Add your regular income, like a paycheck or benefits. Your forecast is built around your next expected payday.',
    add: 'Add income',
    addAnother: 'Add another income',
  },
  expense: {
    title: 'What do you pay regularly?',
    body: 'Add bills and regular spending, like rent, utilities, phone, insurance, or subscriptions. You can add more later.',
    add: 'Add an expense',
    addAnother: 'Add another expense',
  },
  liability: {
    title: 'Any loan or card payments?',
    body: 'Add regular payments on things you owe, like a car loan, student loan, or credit card. Just the payment amount and due date.',
    add: 'Add a payment',
    addAnother: 'Add another payment',
  },
};

function SourceSummary({ s, onRemove }: { s: RecurringSource; onRemove?: () => void }) {
  const v = s.versions[s.versions.length - 1]!;
  return (
    <li className="summary-row">
      <span className="entry-main">
        <span className="entry-title">{s.description}</span>
        <span className="entry-sub">
          {describeRule(v.rule, v.startDate)} · next {formatMedium(v.startDate)}
        </span>
      </span>
      <span className="entry-side">
        <FlowAmount kind={s.kind} cents={v.amountCents} />
        {onRemove && (
          <button type="button" className="button small link" onClick={onRemove} aria-label={`Remove ${s.description}`}>
            Remove
          </button>
        )}
      </span>
    </li>
  );
}

function KindStep({ kind }: { kind: TransactionKind }) {
  const { data, run } = useStore();
  const toast = useToast();
  const items = data.sources.filter((s) => s.kind === kind);
  const [formOpen, setFormOpen] = useState(items.length === 0);
  const copy = STEP_COPY[kind];
  return (
    <div className="stack">
      <p>{copy.body}</p>
      {items.length > 0 && (
        <ul className="summary-list card">
          {items.map((s) => (
            <SourceSummary
              key={s.id}
              s={s}
              onRemove={() => {
                const r = run((d) => ops.deleteSource(d, s.id));
                if (r.ok) toast(`Removed ${s.description}.`);
                else toast(r.error, 'error');
              }}
            />
          ))}
        </ul>
      )}
      {formOpen ? (
        <div className="card">
          <SourceForm kind={kind} onDone={() => setFormOpen(false)} submitLabel="Save" />
        </div>
      ) : (
        <button type="button" className="button secondary" onClick={() => setFormOpen(true)}>
          + {items.length ? copy.addAnother : copy.add}
        </button>
      )}
    </div>
  );
}

function Review() {
  const { data, today } = useStore();
  const forecast = buildForecast(data, today);
  const cycle = paycheckCycles(forecast, 1)[0];
  const low = cycle ? lowestPoint(dailyTimeline(forecast, cycle.start, cycle.end)) : null;
  const groups: [TransactionKind, string][] = [
    ['income', 'Income'],
    ['expense', 'Expenses'],
    ['liability', 'Liability payments'],
  ];
  return (
    <div className="stack">
      {forecast.issue ? (
        <p className="callout callout-warn">
          <span aria-hidden="true">! </span>
          You haven’t added recurring income yet. Your forecast starts the day before your next expected payday, so add income with its next payment date to see your running cash flow. You can do that now
          or later on the Income screen.
        </p>
      ) : (
        <div className="callout callout-info stack">
          <p>
            Your next expected payday is <strong>{formatMedium(forecast.forecastStart!)}</strong>. Your projected cash flow starts at $0 on {formatMedium(forecast.anchor!)} and adds money in and
            subtracts money out from there.
          </p>
          {cycle && low && (
            <p>
              Lowest point before the following payday ({formatMedium(cycle.end)}): <strong>{formatMoney(low.tallyCents)}</strong> on {formatMedium(low.date)}.
            </p>
          )}
        </div>
      )}
      {groups.map(([kind, label]) => {
        const items = data.sources.filter((s) => s.kind === kind);
        return (
          <section key={kind} className="stack-sm">
            <h3>{label}</h3>
            {items.length === 0 ? (
              <p className="muted">None added.</p>
            ) : (
              <ul className="summary-list card">
                {items.map((s) => (
                  <SourceSummary key={s.id} s={s} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <p className="hint">You can change any of these later. Everything stays on this device.</p>
    </div>
  );
}

export function Onboarding() {
  const { data, run } = useStore();
  const [step, setStep] = useState(0);
  const [needIncome, setNeedIncome] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasIncome = data.sources.some((s) => s.kind === 'income' && s.active);

  useEffect(() => {
    if (step > 0) headingRef.current?.focus();
  }, [step]);

  const finish = () => {
    run((d) => ops.completeOnboarding(d));
    navigate('dashboard');
  };

  const next = () => {
    if (step === 1 && !hasIncome && !needIncome) {
      setNeedIncome(true);
      return;
    }
    setNeedIncome(false);
    setStep(step + 1);
  };

  const title = step === 0 ? 'See your cash flow ahead of time' : step === 4 ? 'Check everything over' : STEP_COPY[(['income', 'expense', 'liability'] as const)[step - 1]!].title;

  return (
    <div className="onboarding stack-lg">
      <div className="progress" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="sr-only">
                {s}
                {i < step ? ' (done)' : ''}
              </span>
            </li>
          ))}
        </ol>
        <p className="muted">
          Step {step + 1} of {STEPS.length}
        </p>
      </div>

      <h1 ref={headingRef} tabIndex={-1}>
        {title}
      </h1>

      {step === 0 && (
        <div className="stack">
          <p>Find out whether your income will cover your bills, and spot tight days before they happen.</p>
          <ul className="checklist">
            <li>Add when you expect to get paid</li>
            <li>Add your regular bills and loan payments</li>
            <li>See your projected cash flow day by day</li>
            <li>Record what actually happens, and the forecast updates</li>
          </ul>
          <p className="hint">Takes about 3 minutes. You enter everything yourself, and it stays on this device.</p>
        </div>
      )}
      {step === 1 && <KindStep kind="income" />}
      {step === 2 && <KindStep kind="expense" />}
      {step === 3 && <KindStep kind="liability" />}
      {step === 4 && <Review />}

      {needIncome && (
        <p className="callout callout-warn" role="alert">
          <span aria-hidden="true">! </span>
          Add at least one recurring income so we can start your forecast from your next payday. You can also continue and add it later.
        </p>
      )}

      <div className="form-actions sticky-actions">
        {step > 0 && (
          <button type="button" className="button secondary" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < 4 ? (
          <button type="button" className="button primary" onClick={next}>
            {step === 0 ? 'Get started' : needIncome ? 'Continue without income' : 'Continue'}
          </button>
        ) : (
          <button type="button" className="button primary" onClick={finish}>
            See my forecast
          </button>
        )}
      </div>
    </div>
  );
}
