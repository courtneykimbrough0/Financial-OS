/**
 * Freelance jobs and clients (E3), on Plan › Income. A job is the work; its
 * payment is one ordinary one-time income record, so it shows and counts
 * like any income: on its expected date when expected, not at all when
 * possible or without a date, and once, as recorded, when paid. Finishing the
 * work is never money received.
 */
import { useState, type FormEvent } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { formatMedium, formatShort, type DateStr } from '../../domain/dates';
import { doneNotPaid, jobView, type JobView } from '../../domain/earnings';
import { centsToInput, formatMoney, parseMoney } from '../../domain/money';
import * as ops from '../../domain/operations';
import { certaintyOf, type AppData, type IncomeCertainty, type JobStatus } from '../../domain/types';
import { useStore } from '../../state/store';
import { Field, FlowAmount, FormError, Icon, ListGroup, Modal, MoneyInput, SectionLabel, StatusBadge, useToast } from './common';
import { CertaintyPicker } from './forms';

/** How many paid jobs are listed; the rest wait for the Earnings views (E5). */
const PAID_SHOWN = 10;

const ALL = '';

function paymentText(v: JobView): { text: string; overdue?: boolean } {
  switch (v.payment) {
    case 'pending':
      return { text: 'No payment date · not counted' };
    case 'expected':
      return { text: `Payment expected ${formatShort(v.date!)}` };
    case 'overdue':
      return { text: `Payment expected ${formatShort(v.date!)} · overdue`, overdue: true };
    case 'possible':
      return { text: `Payment possible ${formatShort(v.date!)} · not counted` };
    case 'received':
      return { text: `Paid ${formatShort(v.date!)}` };
    case 'skipped':
      return { text: 'Payment skipped' };
  }
}

const WORK_LABEL: Record<JobView['status'], string> = { planned: 'Planned', done: 'Done', paid: 'Paid' };

/** Unpaid jobs first, overdue first, then by payment date, then those without one. */
function byPayment(a: JobView, b: JobView): number {
  const rank = (v: JobView) => (v.payment === 'overdue' ? 0 : v.date ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.job.description.localeCompare(b.job.description);
}

/** The Add job button, shown beside the recurring Add until there are jobs. */
export function AddJobButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="button secondary small" onClick={onClick}>
      <Icon icon={Plus} size={16} /> Add job
    </button>
  );
}

/** Plan › Income: the freelance jobs, what's done but not paid, and their clients. */
export function FreelanceSection({ adding, onAdding }: { adding: boolean; onAdding: (open: boolean) => void }) {
  const { data, today } = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [clients, setClients] = useState(false);
  const [filter, setFilter] = useState<string>(ALL);
  const jobs = data.jobs ?? [];
  const sheets = (
    <>
      {(adding || open) && (
        <JobSheet
          jobId={open}
          onDone={() => {
            setOpen(null);
            onAdding(false);
          }}
        />
      )}
      {clients && <ClientsSheet onDone={() => setClients(false)} />}
    </>
  );
  if (jobs.length === 0) return sheets;

  const clientList = data.clients ?? [];
  const shown = jobs.filter((j) => filter === ALL || j.clientId === filter).map((j) => jobView(data, j, today));
  const unpaid = shown.filter((v) => v.payment !== 'received' && v.payment !== 'skipped').sort(byPayment);
  const closed = shown.filter((v) => v.payment === 'received' || v.payment === 'skipped').sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? 1 : -1));
  const notPaid = doneNotPaid({ ...data, jobs: jobs.filter((j) => filter === ALL || j.clientId === filter) }, today);

  return (
    <section className="stack" aria-labelledby="jobs-heading">
      <SectionLabel
        id="jobs-heading"
        action={
          <span className="section-actions">
            <AddJobButton onClick={() => onAdding(true)} />
            <button type="button" className="button link small" onClick={() => setClients(true)}>
              Clients
            </button>
          </span>
        }
      >
        Freelance jobs
      </SectionLabel>
      {clientList.length > 1 && (
        <div className="choice-pills" role="group" aria-label="Show jobs for">
          {[{ id: ALL, name: 'All clients' }, ...clientList].map((c) => (
            <button key={c.id} type="button" className={`choice-pill${filter === c.id ? ' selected' : ''}`} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      {notPaid.jobs.length > 0 && (
        <>
          <dl className="details">
            <div>
              <dt>Done, not paid yet</dt>
              <dd>{formatMoney(notPaid.cents)}</dd>
            </div>
          </dl>
          <p className="hint">Work you've done counts only when its payment is expected on a date, or once it's received.</p>
        </>
      )}
      {unpaid.length > 0 && (
        <>
          <h3 className="subhead">Not paid yet</h3>
          <ListGroup>
            {unpaid.map((v) => (
              <li key={v.job.id}>
                <JobRow view={v} data={data} onOpen={() => setOpen(v.job.id)} />
              </li>
            ))}
          </ListGroup>
        </>
      )}
      {closed.length > 0 && (
        <>
          <h3 className="subhead">{closed.some((v) => v.payment === 'skipped') ? 'Paid or skipped' : 'Paid'}</h3>
          <ListGroup>
            {closed.slice(0, PAID_SHOWN).map((v) => (
              <li key={v.job.id}>
                <JobRow view={v} data={data} onOpen={() => setOpen(v.job.id)} />
              </li>
            ))}
          </ListGroup>
        </>
      )}
      {shown.length === 0 && <p className="hint">No jobs for this client yet.</p>}
      {sheets}
    </section>
  );
}

function JobRow({ view, data, onOpen }: { view: JobView; data: AppData; onOpen: () => void }) {
  const client = view.job.clientId ? data.clients?.find((c) => c.id === view.job.clientId)?.name : undefined;
  const payment = paymentText(view);
  const counted = view.payment === 'expected' || view.payment === 'overdue' || view.payment === 'received';
  return (
    <button type="button" className="entry" onClick={onOpen}>
      <span className="entry-main">
        <span className="entry-title">{view.job.description}</span>
        <span className="entry-sub">{[client, WORK_LABEL[view.status]].filter(Boolean).join(' · ')}</span>
        <span className={`entry-sub${payment.overdue ? ' overdue-text' : ''}`}>{payment.text}</span>
      </span>
      <span className="entry-side">
        <FlowAmount kind="income" cents={view.amountCents} possible={!counted && view.payment !== 'skipped'} strike={view.payment === 'skipped'} />
        {view.payment === 'possible' && <StatusBadge status="scheduled" possible />}
      </span>
      <Icon icon={ChevronRight} size={18} className="chevron" />
    </button>
  );
}

const NEW_CLIENT = '__new__';

/** Add or change a job, record or undo its payment, or delete it. */
function JobSheet({ jobId, onDone }: { jobId: string | null; onDone: () => void }) {
  const { data, today, run } = useStore();
  const toast = useToast();
  const job = jobId ? data.jobs?.find((j) => j.id === jobId) : undefined;
  const view = job ? jobView(data, job, today) : undefined;
  const [description, setDescription] = useState(job?.description ?? '');
  const [clientId, setClientId] = useState<string>(job?.clientId ?? '');
  const [newClient, setNewClient] = useState('');
  const [amount, setAmount] = useState(view ? centsToInput(view.payment === 'received' ? job!.amountCents : view.amountCents) : '');
  const [status, setStatus] = useState<JobStatus>(job?.status ?? 'done');
  const [date, setDate] = useState<DateStr>(view?.record && view.payment !== 'received' ? view.record.scheduledDate : '');
  const [certainty, setCertainty] = useState<IncomeCertainty>(view?.record ? certaintyOf(view.record) : 'expected');
  const [mode, setMode] = useState<'edit' | 'pay' | 'delete'>('edit');
  const [payAmount, setPayAmount] = useState(view ? centsToInput(view.amountCents) : '');
  const [payDate, setPayDate] = useState<DateStr>(today);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (jobId && !job) {
    return (
      <Modal title="Job" onClose={onDone}>
        <p>This job no longer exists.</p>
      </Modal>
    );
  }
  const paid = view?.payment === 'received';
  const skipped = view?.payment === 'skipped';
  const moneyLocked = paid || skipped;

  const act = (op: Parameters<typeof run>[0], message: string, close = true) => {
    const r = run(op);
    if (!r.ok) return setError(r.error);
    toast(message);
    if (close) onDone();
    else setMode('edit');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (description.trim() === '') errs.description = 'Enter a description.';
    const cents = parseMoney(amount);
    if (!moneyLocked && (cents === null || cents <= 0)) errs.amount = 'Enter an amount greater than $0.';
    if (clientId === NEW_CLIENT && newClient.trim() === '') errs.client = "Enter the client's name.";
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    const result = run((d, c) => {
      let next = d;
      let client: string | null = clientId === '' ? null : clientId;
      if (clientId === NEW_CLIENT) {
        const id = ops.newId('client');
        const added = ops.addClient(next, newClient, c, id);
        if (!added.ok) return added;
        next = added.data;
        client = id;
      }
      const input: ops.JobInput = {
        description,
        clientId: client,
        amountCents: moneyLocked ? job!.amountCents : cents!,
        status: paid ? 'done' : status,
        ...(moneyLocked ? {} : { expectedDate: date || null, certainty }),
      };
      return job ? ops.editJob(next, job.id, input, c) : ops.addJob(next, input, c);
    });
    if (!result.ok) return setError(result.error);
    toast(job ? `Saved ${description.trim()}.` : `Added ${description.trim()}.`);
    onDone();
  };

  if (job && mode === 'delete') {
    return (
      <Modal title={`Delete ${job.description}?`} onClose={() => setMode('edit')}>
        <div className="stack">
          <p>{view?.record ? 'Its expected payment comes off your forecast too.' : 'It leaves your jobs.'}</p>
          <FormError message={error} />
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setMode('edit')} data-autofocus>
              Keep it
            </button>
            <button type="button" className="button danger" onClick={() => act((d) => ops.deleteJob(d, job.id), `Deleted ${job.description}.`)}>
              Delete
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (job && mode === 'pay') {
    return (
      <Modal title={`Record payment for ${job.description}`} onClose={() => setMode('edit')}>
        <form
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const cents = parseMoney(payAmount);
            if (cents === null || cents <= 0) return setError('Enter an amount greater than $0.');
            act((d, c) => ops.recordJobPayment(d, job.id, { amountCents: cents, date: payDate }, c), `Recorded ${formatMoney(cents)} received for ${job.description}.`);
          }}
        >
          <Field label="Amount received">{(p) => <MoneyInput {...p} value={payAmount} onChange={setPayAmount} autoFocus />}</Field>
          <Field label="Date received">{(p) => <input {...p} type="date" max={today} value={payDate} onChange={(e) => setPayDate(e.target.value)} />}</Field>
          <FormError message={error} />
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setMode('edit')}>
              Back
            </button>
            <button type="submit" className="button primary">
              Save as received
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  const clientList = data.clients ?? [];
  return (
    <Modal title={job ? job.description : 'Add a job'} onClose={onDone}>
      <form onSubmit={submit} noValidate className="stack">
        {view && (
          <p className={paymentText(view).overdue ? 'overdue-text' : 'muted'}>
            {WORK_LABEL[view.status]} · {paymentText(view).text}
          </p>
        )}
        <Field label="What's the job?" error={fieldErrors.description}>
          {(p) => <input {...p} type="text" maxLength={80} placeholder="e.g. Logo design" value={description} onChange={(e) => setDescription(e.target.value)} data-autofocus />}
        </Field>
        <Field label="Client (optional)" error={fieldErrors.client}>
          {(p) => (
            <select {...p} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client</option>
              {clientList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CLIENT}>New client…</option>
            </select>
          )}
        </Field>
        {clientId === NEW_CLIENT && <Field label="Client name">{(p) => <input {...p} type="text" maxLength={60} value={newClient} onChange={(e) => setNewClient(e.target.value)} />}</Field>}
        {moneyLocked ? (
          <p className="hint">
            {paid ? `Paid ${formatMoney(view!.amountCents)} on ${formatMedium(view!.date!)} (agreed ${formatMoney(job!.amountCents)}).` : 'Its payment was skipped. Undo the skip to change the amount or date.'}
          </p>
        ) : (
          <>
            <Field label="Amount" error={fieldErrors.amount}>
              {(p) => <MoneyInput {...p} value={amount} onChange={setAmount} />}
            </Field>
            <fieldset className="choice-field">
              <legend>The work</legend>
              <div className="choice-pills">
                {(
                  [
                    ['planned', 'Planned'],
                    ['done', 'Done'],
                  ] as const
                ).map(([v, label]) => (
                  <label key={v} className={`choice-pill${status === v ? ' selected' : ''}`}>
                    <input type="radio" name="job-status" checked={status === v} onChange={() => setStatus(v)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Expected payment date (optional)" hint={date ? undefined : "Without a date it's pending and isn't counted."}>
              {(p) => <input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            {date && <CertaintyPicker value={certainty} onChange={setCertainty} />}
          </>
        )}
        <FormError message={error} />
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            {job ? 'Save job' : 'Add job'}
          </button>
        </div>
        {job && (
          <div className="action-list">
            {!paid && !skipped && (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setError(null);
                  setMode('pay');
                }}
              >
                Record payment
              </button>
            )}
            {(paid || skipped) && view?.record && (
              <button type="button" className="button secondary" onClick={() => act((d, c) => ops.restoreOccurrence(d, view.record!.id, c), paid ? `Undid the payment for ${job.description}.` : `Restored the payment for ${job.description}.`, false)}>
                {paid ? 'Undo payment' : 'Undo skip'}
              </button>
            )}
            {!paid && (
              <button type="button" className="button danger-link" onClick={() => setMode('delete')}>
                Delete job
              </button>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}

/** Rename or remove clients. Removing one keeps its jobs, without a client. */
function ClientsSheet({ onDone }: { onDone: () => void }) {
  const { data, run } = useStore();
  const toast = useToast();
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries((data.clients ?? []).map((c) => [c.id, c.name])));
  const [added, setAdded] = useState('');
  const [error, setError] = useState<string | null>(null);
  const clients = data.clients ?? [];
  const act = (op: Parameters<typeof run>[0], message: string) => {
    const r = run(op);
    if (!r.ok) return setError(r.error);
    setError(null);
    toast(message);
  };
  return (
    <Modal title="Clients" onClose={onDone}>
      <div className="stack">
        {clients.length === 0 && <p className="hint">No clients yet. Add one here or when you add a job.</p>}
        {clients.map((c) => (
          <div key={c.id} className="stack-sm">
            <Field label={`Name for ${c.name}`}>{(p) => <input {...p} type="text" maxLength={60} value={names[c.id] ?? c.name} onChange={(e) => setNames({ ...names, [c.id]: e.target.value })} />}</Field>
            <div className="card-actions">
              <button type="button" className="button small secondary" disabled={(names[c.id] ?? c.name).trim() === c.name} onClick={() => act((d, k) => ops.renameClient(d, c.id, names[c.id] ?? c.name, k), 'Client renamed.')}>
                Rename
              </button>
              <button type="button" className="button small danger-link" onClick={() => act((d, k) => ops.deleteClient(d, c.id, k), `Removed ${c.name}. Their jobs stay.`)}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <form
          className="stack-sm"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const r = run((d, k) => ops.addClient(d, added, k));
            if (!r.ok) return setError(r.error);
            const id = r.data.clients!.at(-1)!.id;
            setNames((n) => ({ ...n, [id]: added.trim() }));
            setAdded('');
            setError(null);
            toast('Client added.');
          }}
        >
          <Field label="New client">{(p) => <input {...p} type="text" maxLength={60} value={added} onChange={(e) => setAdded(e.target.value)} />}</Field>
          <button type="submit" className="button small secondary">
            Add client
          </button>
        </form>
        <FormError message={error} />
        <div className="form-actions">
          <button type="button" className="button primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
