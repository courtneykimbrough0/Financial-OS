import { AlertCircle, Banknote, CalendarClock, ChevronRight, Info, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffDays, formatMedium, formatShort } from '../../domain/dates';
import { buildForecast, dailyTimeline, lowestPoint, paycheckCycles, timingGapsAhead } from '../../domain/forecast';
import { formatMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import { periodPlan } from '../../domain/plan';
import { describeRule } from '../../domain/recurrence';
import { liabilityPrefix, type OccurrenceRecord, type RecurringSource, type TransactionKind } from '../../domain/types';
import { useAccount } from '../../state/account';
import { useDataMode } from '../../state/mode';
import { useStore } from '../../state/store';
import { FlowAmount, Icon, KindAvatar, Modal, SectionLabel, TagList, useToast } from '../components/common';
import { KIND_COPY, MainPaycheckPicker, OneTimeForm, SourceForm } from '../components/forms';
import { TimingGapsBanner } from '../components/gaps';
import { CashFlowBanner, PeriodBreakdown, TagBreakdown } from '../components/plan';
import { SignedInLine } from '../components/account';
import { RestoreBackupButton } from '../components/backup';
import { navigate } from '../router';

interface StepDef {
  name: string;
  kinds: TransactionKind[];
  title: string;
  body: string;
}

const STEPS: StepDef[] = [
  { name: 'Welcome', kinds: [], title: 'See your cash flow ahead of time', body: 'Find out whether your income will cover your bills, and spot tight days before they happen.' },
  {
    name: 'Income',
    kinds: ['income'],
    title: 'When does money come in?',
    body: 'Add your regular income, like a paycheck or benefits. Your forecast is built around your next expected payday.',
  },
  {
    name: 'Bills',
    kinds: ['bill'],
    title: 'What bills do you pay?',
    body: 'Rent, utilities, phone, insurance, and other regular bills. Add one-time expenses here too, like a car repair.',
  },
  {
    name: 'Subscriptions',
    kinds: ['subscription'],
    title: 'What subscriptions renew?',
    body: 'Streaming services, apps, and memberships that charge you on a schedule.',
  },
  {
    name: 'Liabilities',
    kinds: ['liability'],
    title: 'What do you pay toward debts?',
    body: 'Regular payments on a card, loan, or line of credit.',
  },
  {
    name: 'Savings',
    kinds: ['savings'],
    title: 'What do you set aside?',
    body: 'Money you move into savings on a schedule. It counts as an expense, so cash flow shows what’s left after it.',
  },
  { name: 'Review', kinds: [], title: 'Check everything over', body: 'Tap anything to change it before you start.' },
];
const REVIEW = STEPS.length - 1;
const STEP_OF: Record<TransactionKind, number> = { income: 1, bill: 2, subscription: 3, liability: 4, savings: 5 };

const KIND_SECTION: Record<TransactionKind, { label: string; add: string; addAnother: string; empty: string }> = {
  income: { label: 'Income', add: 'Add income', addAnother: 'Add another income', empty: 'No income added yet' },
  bill: { label: 'Bills', add: 'Add a bill', addAnother: 'Add another bill', empty: 'No bills added yet' },
  subscription: { label: 'Subscriptions', add: 'Add a subscription', addAnother: 'Add another subscription', empty: 'No subscriptions added yet' },
  liability: { label: 'Liability payments', add: 'Add a payment', addAnother: 'Add another payment', empty: 'No liability payments added yet' },
  savings: { label: 'Savings', add: 'Add savings', addAnother: 'Add more savings', empty: 'No savings added yet' },
};

/** Sheet state shared by the setup steps: add a new item, or edit one already added. */
type OneTimeKind = 'income' | 'bill';
type SetupSheet =
  | { mode: 'add'; kind: TransactionKind }
  | { mode: 'edit'; source: RecurringSource }
  | { mode: 'add-once'; kind: OneTimeKind }
  | { mode: 'once'; record: OccurrenceRecord };

/** One-time items of a group (income, or any expense). */
const oneTimes = (records: OccurrenceRecord[], income: boolean) =>
  records.filter((r) => r.sourceId === null && (r.kind === 'income') === income).sort((a, b) => (a.scheduledDate < b.scheduledDate ? -1 : 1));

function OneTimeRow({ r, onOpen }: { r: OccurrenceRecord; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="entry" onClick={onOpen} aria-haspopup="dialog">
        <KindAvatar kind={r.kind} />
        <span className="entry-main">
          <span className="entry-title">{r.description}</span>
          <span className="entry-sub">One time · {formatMedium(r.scheduledDate)}</span>
          <TagList tags={r.tags} />
        </span>
        <span className="entry-side">
          <FlowAmount kind={r.kind} cents={r.scheduledAmountCents} />
          <Icon icon={ChevronRight} size={18} className="chevron" />
        </span>
      </button>
    </li>
  );
}

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
            {liabilityPrefix(s)}
            {describeRule(v.rule, v.startDate)} · next {formatMedium(v.startDate)}
          </span>
          <TagList tags={s.tags} />
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
      <Modal title={KIND_SECTION[sheet.kind].add} onClose={onClose}>
        <SourceForm kind={sheet.kind} onDone={onClose} submitLabel="Save" />
      </Modal>
    );
  }
  if (sheet.mode === 'add-once') {
    return (
      <Modal title={sheet.kind === 'income' ? 'Add one-time income' : 'Add one-time expense'} onClose={onClose}>
        <OneTimeForm kind={sheet.kind} onDone={onClose} />
      </Modal>
    );
  }
  if (sheet.mode === 'once') {
    const r = sheet.record;
    return (
      <Modal title={r.description} onClose={onClose}>
        <div className="stack">
          <p>
            One-time {r.kind === 'income' ? 'income' : 'expense'} of <strong>{formatMoney(r.scheduledAmountCents)}</strong> on {formatMedium(r.scheduledDate)}. It counts once, in the period it falls in.
          </p>
          <p className="hint">To change it, remove it and add it again.</p>
          <button
            type="button"
            className="button danger-link"
            onClick={() => {
              const res = run((d) => ops.deleteOneTime(d, r.id));
              if (res.ok) toast(`Removed ${r.description}.`);
              else toast(res.error, 'error');
              onClose();
            }}
          >
            Remove {r.description}
          </button>
        </div>
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

/** Items of one kind: a list card plus an add button, or an empty card with the add button. */
function KindSection({ kind, onSheet }: { kind: TransactionKind; onSheet: (s: SetupSheet) => void }) {
  const { data } = useStore();
  const items = data.sources.filter((s) => s.kind === kind);
  const copy = KIND_SECTION[kind];
  const addButton = (primary: boolean) => (
    <button type="button" className={`button ${primary ? 'primary' : 'secondary full'}`} onClick={() => onSheet({ mode: 'add', kind })} aria-haspopup="dialog">
      <Icon icon={Plus} size={18} /> {items.length ? copy.addAnother : copy.add}
    </button>
  );

  return items.length === 0 ? (
    <div className="empty-state">
      <span className="empty-icon">
        <KindAvatar kind={kind} />
      </span>
      <p className="empty-title">{copy.empty}</p>
      {addButton(true)}
    </div>
  ) : (
    <div className="stack">
      <ul className="entry-list card list-card">
        {items.map((s) => (
          <SourceRow key={s.id} s={s} onOpen={() => onSheet({ mode: 'edit', source: s })} />
        ))}
      </ul>
      {addButton(false)}
    </div>
  );
}

function OneTimeSection({ income, onSheet }: { income: boolean; onSheet: (s: SetupSheet) => void }) {
  const { data } = useStore();
  const items = oneTimes(data.records, income);
  const kind: OneTimeKind = income ? 'income' : 'bill';
  const label = income ? 'One-time income' : 'One-time expenses';
  return (
    <section className="stack-sm" aria-labelledby={`setup-once-${kind}`}>
      <SectionLabel
        id={`setup-once-${kind}`}
        action={
          <button type="button" className="button small link" onClick={() => onSheet({ mode: 'add-once', kind })} aria-haspopup="dialog">
            <Icon icon={Plus} size={16} /> {income ? 'Add one-time income' : 'Add one-time expense'}
          </button>
        }
      >
        {label}
      </SectionLabel>
      {items.length === 0 ? (
        <p className="card review-empty muted">{income ? 'Like a tax refund or a bonus. Optional.' : 'Like a car repair or a medical bill. Optional.'}</p>
      ) : (
        <ul className="entry-list card list-card">
          {items.map((r) => (
            <OneTimeRow key={r.id} r={r} onOpen={() => onSheet({ mode: 'once', record: r })} />
          ))}
        </ul>
      )}
    </section>
  );
}

function KindStep({ kind, onSheet }: { kind: TransactionKind; onSheet: (s: SetupSheet) => void }) {
  return (
    <div className="stack-lg">
      <KindSection kind={kind} onSheet={onSheet} />
      {kind === 'income' && <MainPaycheckPicker />}
      {(kind === 'income' || kind === 'bill') && <OneTimeSection income={kind === 'income'} onSheet={onSheet} />}
      <p className="hint center">Tap an item to change or remove it.</p>
    </div>
  );
}

function Review({ onSheet, goTo, today }: { onSheet: (s: SetupSheet) => void; goTo: (step: number) => void; today: string }) {
  const { data } = useStore();
  const [about, setAbout] = useState(false);
  const forecast = buildForecast(data, today);
  const cycle = paycheckCycles(forecast, 1)[0];
  const plan = cycle ? periodPlan(forecast, cycle.start, cycle.end) : null;
  const low = cycle ? lowestPoint(dailyTimeline(forecast, cycle.start, cycle.end)) : null;
  const payday = forecast.forecastStart;
  const days = payday ? diffDays(today, payday) : 0;
  const groups: [string, TransactionKind[]][] = [
    ['Income', ['income']],
    ['Bills', ['bill']],
    ['Subscriptions', ['subscription']],
    ['Liability payments', ['liability']],
    ['Savings', ['savings']],
  ];

  return (
    <div className="stack-lg">
      {forecast.issue || !payday ? (
        <div className="callout callout-warn stack-sm" role="note">
          <p>
            <Icon icon={AlertCircle} size={16} />
            <strong>Add recurring income to start your forecast.</strong>
          </p>
          <p>Your forecast starts the day before your next expected payday. You can add it now or later on the Income screen.</p>
          <button type="button" className="button small secondary" onClick={() => goTo(STEP_OF.income)}>
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
              <button type="button" className="icon-button small-icon" onClick={() => setAbout(true)} aria-label="How the running total works">
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
                Lowest running total before {formatShort(cycle.end)}: <strong className={low.tallyCents < 0 ? 'negative-text' : ''}>{formatMoney(low.tallyCents)}</strong>
                <span className="muted"> · {formatShort(low.date)}</span>
              </span>
            </div>
          )}
        </section>
      )}

      {payday && <TimingGapsBanner gaps={timingGapsAhead(forecast)} from={payday} />}

      {plan && <PeriodBreakdown plan={plan} title="First pay period" />}
      {plan && <TagBreakdown plan={plan} />}

      {groups.map(([label, kinds]) => {
        const items = data.sources.filter((s) => kinds.includes(s.kind));
        // One-time expenses are added on the Bills step, so they're listed there.
        const once = label === 'Income' ? oneTimes(data.records, true) : label === 'Bills' ? oneTimes(data.records, false) : [];
        return (
          <section key={label} className="stack-sm" aria-labelledby={`review-${label}`}>
            <SectionLabel
              id={`review-${label}`}
              action={
                <button type="button" className="button small link" onClick={() => goTo(STEP_OF[kinds[0]!])}>
                  <Icon icon={Plus} size={16} /> Add
                  <span className="sr-only"> {KIND_COPY[kinds[0]!].noun}</span>
                </button>
              }
            >
              {label}
            </SectionLabel>
            {items.length + once.length === 0 ? (
              <p className="card review-empty muted">None added.</p>
            ) : (
              <ul className="entry-list card list-card">
                {items.map((s) => (
                  <SourceRow key={s.id} s={s} onOpen={() => onSheet({ mode: 'edit', source: s })} />
                ))}
                {once.map((r) => (
                  <OneTimeRow key={r.id} r={r} onOpen={() => onSheet({ mode: 'once', record: r })} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <p className="hint center">
        <Icon icon={CalendarClock} size={16} /> You can change any of these later.
      </p>

      {about && forecast.anchor && payday && (
        <Modal title="How the running total works" onClose={() => setAbout(false)}>
          <div className="stack">
            <p>
              The running total starts at $0 on {formatMedium(forecast.anchor)}, the day before your next expected payday ({formatMedium(payday)}), and adds money in and subtracts money out day by day.
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
  const account = useAccount();
  const [step, setStep] = useState(0);
  const [needIncome, setNeedIncome] = useState(false);
  const [sheet, setSheet] = useState<SetupSheet | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasIncome = data.sources.some((s) => s.kind === 'income' && s.active);
  const plan = useMemo(() => {
    const forecast = buildForecast(data, today);
    const cycle = paycheckCycles(forecast, 1)[0];
    return cycle ? periodPlan(forecast, cycle.start, cycle.end) : null;
  }, [data, today]);
  const def = STEPS[step]!;

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
    if (step === STEP_OF.income && !hasIncome && !needIncome) {
      setNeedIncome(true);
      return;
    }
    setNeedIncome(false);
    setStep(step + 1);
  };

  return (
    <div className="onboarding stack-lg">
      <div className="progress" aria-label={`Step ${step + 1} of ${STEPS.length}: ${def.name}`}>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.name} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="sr-only">
                {s.name}
                {i < step ? ' (done)' : ''}
              </span>
            </li>
          ))}
        </ol>
        <p className="muted small">
          Step {step + 1} of {STEPS.length} · {def.name}
        </p>
      </div>

      {step > 0 && <CashFlowBanner plan={plan} />}

      <header className="onboarding-header">
        <h1 ref={headingRef} tabIndex={-1}>
          {def.title}
        </h1>
        <p className="muted">{def.body}</p>
      </header>

      {step === 0 && (
        <div className="stack">
          <ul className="card list-card checklist">
            <li>Add when you expect to get paid</li>
            <li>Add your bills, subscriptions, loan payments, and savings</li>
            <li>See your cash flow for each pay period and your running total day by day</li>
            <li>Record what actually happens, and the forecast updates</li>
          </ul>
          <p className="hint center">
            Takes about 3 minutes. You enter everything yourself, and it’s saved {account ? 'to your account' : 'only on this device'}.
          </p>
          <button
            type="button"
            className="button link full"
            onClick={() => {
              void enterSample().then(() => navigate('dashboard'));
            }}
          >
            Explore with sample data
          </button>
          <div className="center">
            <RestoreBackupButton label="Have a backup? Restore it" />
          </div>
          <SignedInLine />
        </div>
      )}
      {def.kinds.length > 0 && <KindStep key={step} kind={def.kinds[0]!} onSheet={setSheet} />}
      {step === REVIEW && <Review onSheet={setSheet} goTo={setStep} today={today} />}

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
        {step < REVIEW ? (
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
