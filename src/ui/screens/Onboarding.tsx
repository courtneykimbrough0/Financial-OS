import { AlertCircle, Banknote, CalendarClock, ChevronRight, Info, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { diffDays, formatMedium, formatShort } from '../../domain/dates';
import { buildForecast, dailyTimeline, lowestPoint, paycheckCycles } from '../../domain/forecast';
import { formatMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import { describeRule } from '../../domain/recurrence';
import type { RecurringSource, TransactionKind } from '../../domain/types';
import { useDataMode } from '../../state/mode';
import { useStore } from '../../state/store';
import { FlowAmount, Icon, KindAvatar, Modal, SectionLabel, useToast } from '../components/common';
import { KIND_COPY, SourceForm } from '../components/forms';
import { navigate } from '../router';

const STEPS = ['Welcome', 'Income', 'Expenses', 'Liabilities', 'Review'] as const;
const KIND_STEP: Record<TransactionKind, number> = { income: 1, expense: 2, liability: 3 };

const STEP_COPY: Record<TransactionKind, { title: string; body: string; add: string; addAnother: string; empty: string }> = {
  income: {
    title: 'When does money come in?',
    body: 'Add your regular income, like a paycheck or benefits. Your forecast is built around your next expected payday.',
    add: 'Add income',
    addAnother: 'Add another income',
    empty: 'No income added yet',
  },
  expense: {
    title: 'What do you pay regularly?',
    body: 'Rent, utilities, phone, insurance, subscriptions. You can add more later.',
    add: 'Add an expense',
    addAnother: 'Add another expense',
    empty: 'No expenses added yet',
  },
  liability: {
    title: 'Any loan or card payments?',
    body: 'A car loan, student loan, or credit card. Just the payment amount and due date.',
    add: 'Add a payment',
    addAnother: 'Add another payment',
    empty: 'No liability payments added yet',
  },
};

/** Sheet state shared by the setup steps: add a new item, or edit one already added. */
type SetupSheet = { mode: 'add'; kind: TransactionKind } | { mode: 'edit'; source: RecurringSource };

/** One tappable row per added item; tapping opens it in a sheet. */
function SourceRow({ s, onOpen }: { s: RecurringSource; onOpen: () => void }) {
  const v = s.versions[s.versions.length - 1]!;
  return (
    <li>
      <button type="button" className="entry" onClick={onOpen} aria-haspopup="dialog">
        <KindAvatar kind={s.kind} />
        <span className="entry-main">
          <span className="entry-title">{s.description}</span>
          <span className="entry-sub">
            {describeRule(v.rule, v.startDate)} · next {formatMedium(v.startDate)}
          </span>
        </span>
        <span className="entry-side">
          <FlowAmount kind={s.kind} cents={v.amountCents} />
          <Icon icon={ChevronRight} size={18} className="chevron" />
        </span>
      </button>
    </li>
  );
}

function SetupSheetView({ sheet, onClose }: { sheet: SetupSheet; onClose: () => void }) {
  const { run } = useStore();
  const toast = useToast();
  if (sheet.mode === 'add') {
    return (
      <Modal title={STEP_COPY[sheet.kind].add} onClose={onClose}>
        <SourceForm kind={sheet.kind} onDone={onClose} submitLabel="Save" />
      </Modal>
    );
  }
  const s = sheet.source;
  return (
    <Modal title={`Edit ${s.description}`} onClose={onClose}>
      <SourceForm kind={s.kind} source={s} onDone={onClose} submitLabel="Save" />
      <button
        type="button"
        className="button danger-link"
        onClick={() => {
          const r = run((d) => ops.deleteSource(d, s.id));
          if (r.ok) toast(`Removed ${s.description}.`);
          else toast(r.error, 'error');
          onClose();
        }}
      >
        Remove {s.description}
      </button>
    </Modal>
  );
}

function KindStep({ kind, onSheet }: { kind: TransactionKind; onSheet: (s: SetupSheet) => void }) {
  const { data } = useStore();
  const items = data.sources.filter((s) => s.kind === kind);
  const copy = STEP_COPY[kind];
  return (
    <div className="stack">
      {items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">
            <KindAvatar kind={kind} />
          </span>
          <p className="empty-title">{copy.empty}</p>
          <button type="button" className="button primary" onClick={() => onSheet({ mode: 'add', kind })} aria-haspopup="dialog">
            <Icon icon={Plus} size={18} /> {copy.add}
          </button>
        </div>
      ) : (
        <>
          <ul className="entry-list card list-card">
            {items.map((s) => (
              <SourceRow key={s.id} s={s} onOpen={() => onSheet({ mode: 'edit', source: s })} />
            ))}
          </ul>
          <button type="button" className="button secondary full" onClick={() => onSheet({ mode: 'add', kind })} aria-haspopup="dialog">
            <Icon icon={Plus} size={18} /> {copy.addAnother}
          </button>
          <p className="hint center">Tap an item to change or remove it.</p>
        </>
      )}
    </div>
  );
}

function Review({ onSheet, goTo, today }: { onSheet: (s: SetupSheet) => void; goTo: (step: number) => void; today: string }) {
  const { data } = useStore();
  const [about, setAbout] = useState(false);
  const forecast = buildForecast(data, today);
  const cycle = paycheckCycles(forecast, 1)[0];
  const low = cycle ? lowestPoint(dailyTimeline(forecast, cycle.start, cycle.end)) : null;
  const groups: [TransactionKind, string][] = [
    ['income', 'Income'],
    ['expense', 'Expenses'],
    ['liability', 'Liability payments'],
  ];
  const payday = forecast.forecastStart;
  const days = payday ? diffDays(today, payday) : 0;

  return (
    <div className="stack-lg">
      {forecast.issue || !payday ? (
        <div className="callout callout-warn stack-sm" role="note">
          <p>
            <Icon icon={AlertCircle} size={16} />
            <strong>Add recurring income to start your forecast.</strong>
          </p>
          <p>Your forecast starts the day before your next expected payday. You can add it now or later on the Income screen.</p>
          <button type="button" className="button small secondary" onClick={() => goTo(KIND_STEP.income)}>
            Add income
          </button>
        </div>
      ) : (
        <section className="card hero review-hero" aria-labelledby="review-hero-label">
          <div className="hero-body">
            <div className="hero-top">
              <p className="hero-label" id="review-hero-label">
                Next expected payday
              </p>
              <button type="button" className="icon-button small-icon" onClick={() => setAbout(true)} aria-label="How projected cash flow works">
                <Icon icon={Info} size={20} />
              </button>
            </div>
            <p className="hero-value">
              {formatShort(payday)}
              <span className="hero-when">{days > 1 ? `in ${days} days` : days === 1 ? 'tomorrow' : 'today'}</span>
            </p>
          </div>
          {cycle && low && (
            <div className="hero-footer">
              <Icon icon={low.tallyCents < 0 ? AlertCircle : Banknote} size={22} className={low.tallyCents < 0 ? 'flag-neg' : 'hero-footer-icon'} />
              <span>
                Lowest point before {formatShort(cycle.end)}: <strong className={low.tallyCents < 0 ? 'negative-text' : ''}>{formatMoney(low.tallyCents)}</strong>
                <span className="muted"> · {formatShort(low.date)}</span>
              </span>
            </div>
          )}
        </section>
      )}

      {groups.map(([kind, label]) => {
        const items = data.sources.filter((s) => s.kind === kind);
        return (
          <section key={kind} className="stack-sm" aria-labelledby={`review-${kind}`}>
            <SectionLabel
              id={`review-${kind}`}
              action={
                <button type="button" className="button small link" onClick={() => onSheet({ mode: 'add', kind })} aria-haspopup="dialog">
                  <Icon icon={Plus} size={16} /> Add
                  <span className="sr-only"> {KIND_COPY[kind].noun}</span>
                </button>
              }
            >
              {label}
            </SectionLabel>
            {items.length === 0 ? (
              <p className="card review-empty muted">None added.</p>
            ) : (
              <ul className="entry-list card list-card">
                {items.map((s) => (
                  <SourceRow key={s.id} s={s} onOpen={() => onSheet({ mode: 'edit', source: s })} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <p className="hint center">
        <Icon icon={CalendarClock} size={16} /> You can change any of these later. Everything is saved on this device.
      </p>

      {about && forecast.anchor && payday && (
        <Modal title="How projected cash flow works" onClose={() => setAbout(false)}>
          <div className="stack">
            <p>
              Projected cash flow starts at $0 on {formatMedium(forecast.anchor)}, the day before your next expected payday ({formatMedium(payday)}), and adds money in and subtracts money out day by day.
            </p>
            <p>It shows timing, separate from your bank balance.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Onboarding() {
  const { data, run, today } = useStore();
  const { enterSample } = useDataMode();
  const [step, setStep] = useState(0);
  const [needIncome, setNeedIncome] = useState(false);
  const [sheet, setSheet] = useState<SetupSheet | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasIncome = data.sources.some((s) => s.kind === 'income' && s.active);

  useEffect(() => {
    if (step > 0) headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (hasIncome) setNeedIncome(false);
  }, [hasIncome]);

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

  const kind = step >= 1 && step <= 3 ? (['income', 'expense', 'liability'] as const)[step - 1]! : null;
  const title = step === 0 ? 'See your cash flow ahead of time' : step === 4 ? 'Check everything over' : STEP_COPY[kind!].title;
  const subtitle =
    step === 0
      ? 'Find out whether your income will cover your bills, and spot tight days before they happen.'
      : step === 4
        ? 'Tap anything to change it before you start.'
        : STEP_COPY[kind!].body;

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
        <p className="muted small">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
      </div>

      <header className="onboarding-header">
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        <p className="muted">{subtitle}</p>
      </header>

      {step === 0 && (
        <div className="stack">
          <ul className="card list-card checklist">
            <li>Add when you expect to get paid</li>
            <li>Add your regular bills and loan payments</li>
            <li>See your projected cash flow day by day</li>
            <li>Record what actually happens, and the forecast updates</li>
          </ul>
          <p className="hint center">Takes about 3 minutes. You enter everything yourself, and it is saved only on this device.</p>
          <button
            type="button"
            className="button link full"
            onClick={() => {
              enterSample();
              navigate('dashboard');
            }}
          >
            Explore with sample data
          </button>
        </div>
      )}
      {kind && <KindStep kind={kind} onSheet={setSheet} />}
      {step === 4 && <Review onSheet={setSheet} goTo={setStep} today={today} />}

      {needIncome && (
        <p className="callout callout-warn" role="alert">
          <Icon icon={AlertCircle} size={16} /> Add at least one recurring income so we can start your forecast from your next payday. You can also continue and add it later.
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

      {sheet && <SetupSheetView sheet={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
