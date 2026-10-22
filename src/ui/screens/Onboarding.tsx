import { AlertCircle, Banknote, CalendarClock, ChevronRight, Info, Plus } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, diffDays, formatMedium, formatShort, type DateStr } from '../../domain/dates';
import { buildForecast, dailyTimeline, entriesInRange, explainTimingGaps, lowestPoint } from '../../domain/forecast';
import { formatMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import { periodPlan } from '../../domain/plan';
import { describeRule } from '../../domain/recurrence';
import { liabilityPrefix, type AppData, type OccurrenceRecord, type RecurringKind, type RecurringSource, type TransactionKind } from '../../domain/types';
import { useAccount } from '../../state/account';
import { useDataMode } from '../../state/mode';
import { useStore } from '../../state/store';
import { EmptyLine, FlowAmount, FormError, Icon, KindAvatar, Modal, SectionLabel, StatusBadge, TagList, useToast } from '../components/common';
import { KIND_COPY, OneTimeForm, SourceForm } from '../components/forms';
import { TimingGapsBanner } from '../components/gaps';
import { CashFlowBanner, PeriodBreakdown, TagBreakdown } from '../components/plan';
import { useAccountSlot } from '../../state/slots';
import { SignedInLine } from '../components/account';
import { RestoreBackupButton } from '../components/backup';
import { navigate } from '../router';

interface StepDef {
  name: string;
  kinds: RecurringKind[];
  title: string;
  body: string;
}

const STEPS: StepDef[] = [
  {
    name: 'Income',
    kinds: ['income'],
    title: 'When do you get paid?',
    body: 'Add your regular income, like a paycheck or benefits. Your forecast starts from your next payday.',
  },
  {
    name: 'Payments',
    kinds: ['bill', 'subscription', 'liability', 'reserve'],
    title: 'What do you pay regularly?',
    body: 'Bills, subscriptions, and loan or card payments. Add one-time spending here too, like a car repair.',
  },
  { name: 'Review', kinds: [], title: 'Check everything over', body: 'Tap anything to change it before you start.' },
];
const REVIEW = STEPS.length - 1;
const STEP_OF: Record<RecurringKind, number> = { income: 0, bill: 1, subscription: 1, liability: 1, reserve: 1 };
const PAYMENT_KINDS: { kind: PaymentKind; label: string }[] = [
  { kind: 'bill', label: 'Bill' },
  { kind: 'subscription', label: 'Subscription' },
  { kind: 'liability', label: 'Loan or card payment' },
];
type PaymentKind = 'bill' | 'subscription' | 'liability';

const KIND_SECTION: Record<RecurringKind, { label: string; add: string; addAnother: string; empty: string }> = {
  income: { label: 'Income', add: 'Add income', addAnother: 'Add another income', empty: 'No income added yet' },
  bill: { label: 'Bills', add: 'Add a bill', addAnother: 'Add another bill', empty: 'No bills added yet' },
  subscription: { label: 'Subscriptions', add: 'Add a subscription', addAnother: 'Add another subscription', empty: 'No subscriptions added yet' },
  liability: { label: 'Liability payments', add: 'Add a payment', addAnother: 'Add another payment', empty: 'No liability payments added yet' },
  reserve: { label: 'Strategic Reserves', add: 'Add a reserve', addAnother: 'Add another reserve', empty: 'No reserves added yet' },
};

/** Setup's first look: the next four weeks from today, read from the one forecast. Nothing until there's income to start it. */
const FIRST_LOOK_DAYS = 28;
function firstLook(data: AppData, today: DateStr) {
  const forecast = buildForecast(data, today);
  const end = addDays(today, FIRST_LOOK_DAYS - 1);
  if (forecast.issue) return { forecast, end, plan: null, low: null };
  return { forecast, end, plan: periodPlan(forecast, today, end), low: lowestPoint(dailyTimeline(forecast, today, end)) };
}

/** Sheet state shared by the setup steps: add a new item, or edit one already added. */
type OneTimeKind = 'income' | 'varied';
type SetupSheet =
  | { mode: 'add'; kind: RecurringKind }
  | { mode: 'add-payment' }
  | { mode: 'edit'; source: RecurringSource }
  | { mode: 'add-once'; kind: OneTimeKind }
  | { mode: 'once'; record: OccurrenceRecord };

/** One-time items of a kind. */
const oneTimes = (records: OccurrenceRecord[], kind: TransactionKind) =>
  records.filter((r) => r.sourceId === null && r.kind === kind).sort((a, b) => (a.scheduledDate < b.scheduledDate ? -1 : 1));

function OneTimeRow({ r, onOpen }: { r: OccurrenceRecord; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="entry" onClick={onOpen} aria-haspopup="dialog">
        <KindAvatar kind={r.kind} />
        <span className="entry-main">
          <span className="entry-title">{r.description}</span>
          <span className="entry-sub">One time · {formatMedium(r.scheduledDate)}</span>
          {r.certainty === 'possible' && <StatusBadge status="scheduled" possible />}
          <TagList tags={r.tags} />
        </span>
        <span className="entry-side">
          <FlowAmount kind={r.kind} cents={r.scheduledAmountCents} release={r.release} possible={r.certainty === 'possible'} />
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
          {s.certainty === 'possible' && <StatusBadge status="scheduled" possible />}
          <TagList tags={s.tags} />
        </span>
        <span className="entry-side">
          <FlowAmount kind={s.kind} cents={v.amountCents} possible={s.certainty === 'possible'} />
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
  if (sheet.mode === 'add-payment') return <AddPaymentSheet onClose={onClose} />;
  if (sheet.mode === 'add-once') {
    return (
      <Modal title={sheet.kind === 'income' ? 'Add one-time income' : 'Add varied spending'} onClose={onClose}>
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

/** One sheet for every regular payment: pick what kind it is, then fill in that kind's form. */
function AddPaymentSheet({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<PaymentKind>('bill');
  return (
    <Modal title="Add a payment" onClose={onClose}>
      <div className="stack">
        <fieldset className="choice-field">
          <legend>What kind of payment?</legend>
          <div className="choice-pills">
            {PAYMENT_KINDS.map((k) => (
              <label key={k.kind} className={`choice-pill${kind === k.kind ? ' selected' : ''}`}>
                <input type="radio" name="payment-kind" value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <SourceForm key={kind} kind={kind} onDone={onClose} submitLabel="Save" />
      </div>
    </Modal>
  );
}

/** Bills, subscriptions and liability payments in one list, with one Add; Strategic Reserves offered after, as optional. */
function PaymentsStep({ onSheet }: { onSheet: (s: SetupSheet) => void }) {
  const { data } = useStore();
  const payments = data.sources.filter((s) => s.kind === 'bill' || s.kind === 'subscription' || s.kind === 'liability');
  const reserves = data.sources.filter((s) => s.kind === 'reserve');
  return (
    <div className="stack-lg">
      <div className="stack">
        {payments.length > 0 && (
          <ul className="entry-list card list-card">
            {payments.map((s) => (
              <SourceRow key={s.id} s={s} onOpen={() => onSheet({ mode: 'edit', source: s })} />
            ))}
          </ul>
        )}
        <button type="button" className={`button ${payments.length ? 'secondary full' : 'primary'}`} onClick={() => onSheet({ mode: 'add-payment' })} aria-haspopup="dialog">
          <Icon icon={Plus} size={18} /> {payments.length ? 'Add another payment' : 'Add a payment'}
        </button>
      </div>
      <OneTimeSection income={false} onSheet={onSheet} />
      <section className="stack-sm" aria-labelledby="setup-reserves">
        <SectionLabel
          id="setup-reserves"
          action={
            <button type="button" className="button small link" onClick={() => onSheet({ mode: 'add', kind: 'reserve' })} aria-haspopup="dialog">
              <Icon icon={Plus} size={16} /> Add a reserve
            </button>
          }
        >
          Strategic Reserves
        </SectionLabel>
        {reserves.length === 0 ? (
          <p className="muted">Set money aside on a schedule (optional).</p>
        ) : (
          <ul className="entry-list card list-card">
            {reserves.map((s) => (
              <SourceRow key={s.id} s={s} onOpen={() => onSheet({ mode: 'edit', source: s })} />
            ))}
          </ul>
        )}
      </section>
      {payments.length + reserves.length + oneTimes(data.records, 'varied').length > 0 && <p className="hint center">Tap an item to change or remove it.</p>}
    </div>
  );
}

/** Items of one kind: a list card plus an add button, or one line with the add button. */
function KindSection({ kind, onSheet }: { kind: RecurringKind; onSheet: (s: SetupSheet) => void }) {
  const { data } = useStore();
  const items = data.sources.filter((s) => s.kind === kind);
  const copy = KIND_SECTION[kind];
  const addButton = (primary: boolean) => (
    <button type="button" className={`button ${primary ? 'primary' : 'secondary full'}`} onClick={() => onSheet({ mode: 'add', kind })} aria-haspopup="dialog">
      <Icon icon={Plus} size={18} /> {items.length ? copy.addAnother : copy.add}
    </button>
  );

  return items.length === 0 ? (
    <EmptyLine action={addButton(true)}>{copy.empty}</EmptyLine>
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
  const kind: OneTimeKind = income ? 'income' : 'varied';
  const items = oneTimes(data.records, kind);
  const label = income ? 'One-time income' : 'Varied spending';
  return (
    <section className="stack-sm" aria-labelledby={`setup-once-${kind}`}>
      <SectionLabel
        id={`setup-once-${kind}`}
        action={
          <button type="button" className="button small link" onClick={() => onSheet({ mode: 'add-once', kind })} aria-haspopup="dialog">
            <Icon icon={Plus} size={16} /> {income ? 'Add one-time income' : 'Add spending'}
          </button>
        }
      >
        {label}
      </SectionLabel>
      {items.length === 0 ? (
        <EmptyLine>{income ? 'Like a tax refund or a bonus. Optional.' : 'Like a car repair or a medical bill. Optional.'}</EmptyLine>
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

function KindStep({ kind, onSheet }: { kind: RecurringKind; onSheet: (s: SetupSheet) => void }) {
  const { data } = useStore();
  const anything = data.sources.some((s) => s.kind === kind) || (kind === 'income' && oneTimes(data.records, 'income').length > 0);
  return (
    <div className="stack-lg">
      <KindSection kind={kind} onSheet={onSheet} />
      {kind === 'income' && <OneTimeSection income onSheet={onSheet} />}
      {anything && <p className="hint center">Tap an item to change or remove it.</p>}
    </div>
  );
}

function Review({ onSheet, goTo, today }: { onSheet: (s: SetupSheet) => void; goTo: (step: number) => void; today: string }) {
  const { data } = useStore();
  const [about, setAbout] = useState(false);
  const { forecast, end, plan, low } = firstLook(data, today);
  const payday = forecast.forecastStart;
  const days = payday ? diffDays(today, payday) : 0;
  // Payments due before the running total starts: in cash flow, not in the running total.
  const beforePayday = forecast.anchor && forecast.anchor >= today ? entriesInRange(forecast, today, forecast.anchor).filter((e) => e.counts && e.signedCents < 0) : [];
  const beforeTotal = beforePayday.reduce((n, e) => n + e.amountCents, 0);
  const groups: [string, RecurringKind[]][] = [
    ['Income', ['income']],
    ['Bills', ['bill']],
    ['Subscriptions', ['subscription']],
    ['Liability payments', ['liability']],
    ['Strategic Reserves', ['reserve']],
  ];
  const sections = groups.map(([label, kinds]) => ({
    label,
    kinds,
    items: data.sources.filter((s) => kinds.includes(s.kind)),
    // Varied spending is added on the Bills step, so it's listed there.
    once: label === 'Income' ? oneTimes(data.records, 'income') : label === 'Bills' ? oneTimes(data.records, 'varied') : [],
  }));
  const filled = sections.filter((g) => g.items.length + g.once.length > 0);
  const missing = sections.filter((g) => g.items.length + g.once.length === 0);

  return (
    <div className="stack-lg">
      {forecast.issue || !payday ? (
        <div className="callout callout-warn stack-sm" role="note">
          <p>
            <Icon icon={AlertCircle} size={16} />
            <strong>Add your income to see what's ahead.</strong>
          </p>
          <p>You can also continue and add it later.</p>
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
          {low && (
            <div className="hero-footer">
              <Icon icon={low.tallyCents < 0 ? AlertCircle : Banknote} size={22} className={low.tallyCents < 0 ? 'flag-neg' : 'hero-footer-icon'} />
              <span>
                Lowest running total through {formatShort(end)}: <strong className={low.tallyCents < 0 ? 'negative-text' : ''}>{formatMoney(low.tallyCents)}</strong>
                <span className="muted"> · {formatShort(low.date)}</span>
              </span>
            </div>
          )}
        </section>
      )}

      {beforePayday.length > 0 && forecast.anchor && (
        <p className="callout callout-info" role="note">
          <Icon icon={Info} size={16} />
          <span>
            {beforePayday.length === 1 ? '1 payment' : `${beforePayday.length} payments`} ({formatMoney(beforeTotal)}) {beforePayday.length === 1 ? 'is' : 'are'} due before your next payday. Make sure the money you have now covers {beforePayday.length === 1 ? 'it' : 'them'}.
          </span>
        </p>
      )}

      {payday && <TimingGapsBanner gaps={explainTimingGaps(forecast)} from={payday} horizonEnd={forecast.horizonEnd} />}

      {/* The cash-flow banner above already gives the four weeks' range and cash flow. */}
      {plan && <PeriodBreakdown plan={plan} title="Next 4 weeks" showRange={false} total={false} />}
      {plan && <TagBreakdown plan={plan} />}

      {filled.map(({ label, kinds, items, once }) => {
        return (
          <section key={label} className="stack-sm" aria-labelledby={`review-${kinds[0]}`}>
            <SectionLabel
              id={`review-${kinds[0]}`}
              action={
                <button type="button" className="button small link" onClick={() => goTo(STEP_OF[kinds[0]!])}>
                  <Icon icon={Plus} size={16} /> Add
                  <span className="sr-only"> {KIND_COPY[kinds[0]!].noun}</span>
                </button>
              }
            >
              {label}
            </SectionLabel>
            <ul className="entry-list card list-card">
              {items.map((s) => (
                <SourceRow key={s.id} s={s} onOpen={() => onSheet({ mode: 'edit', source: s })} />
              ))}
              {once.map((r) => (
                <OneTimeRow key={r.id} r={r} onOpen={() => onSheet({ mode: 'once', record: r })} />
              ))}
            </ul>
          </section>
        );
      })}

      {missing.length > 0 && (
        <p className="review-missing muted">
          Not added:{' '}
          {missing.map(({ label, kinds }, i) => (
            <Fragment key={label}>
              {i > 0 && ', '}
              <button type="button" className="button small link inline-link" onClick={() => goTo(STEP_OF[kinds[0]!])} aria-label={`Add ${label === 'Strategic Reserves' ? label : label.toLowerCase()}`}>
                {label === 'Strategic Reserves' ? label : label.toLowerCase()}
              </button>
            </Fragment>
          ))}
          .
        </p>
      )}

      <p className="hint center">
        <Icon icon={CalendarClock} size={16} /> You can change any of these later.
      </p>

      {about && forecast.anchor && payday && (
        <Modal title="How the running total works" onClose={() => setAbout(false)}>
          <div className="stack">
            <p>
              Your running total starts at $0 the day before your next paycheck, then adds what comes in and subtracts what goes out. It shows whether your income arrives in time for your payments; your bank balance can differ.
            </p>
            <p>Payments due before {formatMedium(payday)} come from the money you have now.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Onboarding() {
  const slot = useAccountSlot();
  const { data, run, today } = useStore();
  const { enterSample } = useDataMode();
  const account = useAccount();
  const [step, setStep] = useState(0);
  const [needIncome, setNeedIncome] = useState(false);
  const [sheet, setSheet] = useState<SetupSheet | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const hasIncome = data.sources.some((s) => s.kind === 'income' && s.active);
  const plan = useMemo(() => firstLook(data, today).plan, [data, today]);
  const def = STEPS[step]!;

  useEffect(() => {
    // Not on first arrival: only when the person moves between steps.
    if (moved.current) headingRef.current?.focus();
    moved.current = true;
  }, [step]);

  useEffect(() => {
    if (hasIncome) setNeedIncome(false);
  }, [hasIncome]);

  const finish = () => {
    run((d) => ops.completeOnboarding(d));
    navigate('home');
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

      {plan && <CashFlowBanner plan={plan} />}

      <header className="onboarding-header">
        <h1 ref={headingRef} tabIndex={-1}>
          {def.title}
        </h1>
        <p className="muted">{def.body}</p>
      </header>

      {step === 0 && (
        <>
          <KindStep kind="income" onSheet={setSheet} />
          <div className="stack-sm center">
            <p className="hint">Your income is enough for a first forecast. Your data stays {account ? 'in your account' : 'on this device'}.</p>
            <button
              type="button"
              className="button link"
              onClick={() => {
                void enterSample().then((r) => (r.ok ? navigate('home') : setSampleError(r.message)));
              }}
            >
              Explore with sample data
            </button>
            <FormError message={sampleError} />
            <div>
              <RestoreBackupButton label="Restore a backup" />
            </div>
            {slot ? <slot.Line /> : <SignedInLine />}
          </div>
        </>
      )}
      {step === 1 && <PaymentsStep onSheet={setSheet} />}
      {step === REVIEW && <Review onSheet={setSheet} goTo={setStep} today={today} />}

      {needIncome && (
        <p className="callout callout-warn" role="alert">
          <Icon icon={AlertCircle} size={16} /> Add your income to see what's ahead. You can also continue and add it later.
        </p>
      )}

      {step === REVIEW ? (
        <div className="form-actions sticky-actions review-actions">
          <button type="button" className="button primary" onClick={finish}>
            Looks right
          </button>
          <button type="button" className="button secondary" onClick={() => setStep(step - 1)}>
            Change something
          </button>
        </div>
      ) : (
        <div className="form-actions sticky-actions">
          {step > 0 && (
            <button type="button" className="button secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button type="button" className="button primary" onClick={next}>
            {needIncome ? 'Continue without income' : 'Continue'}
          </button>
        </div>
      )}

      {sheet && <SetupSheetView sheet={sheet} onClose={() => setSheet(null)} />}
    </div>
  );
}
