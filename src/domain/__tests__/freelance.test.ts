import { describe, expect, it } from 'vitest';
import { activityView } from '../activity';
import { doneNotPaid, jobView } from '../earnings';
import { buildForecast, overdueEntries, periodKpis, type Forecast } from '../forecast';
import { homeView } from '../home';
import * as ops from '../operations';
import type { AppData, FreelanceJob } from '../types';
import { clockAt, expectError, source, unwrap, usd } from './helpers';

// E3: freelance income. Work done is never money received; a job's payment is one income record. Monday Oct 19, 2026.
const TODAY = '2026-10-19';
const clock = clockAt(TODAY);
const SETUP = clockAt('2026-10-05');

/** Paycheck $1,000 every 2 weeks from Oct 23; rent $900 on the 25th. */
function baseline(): AppData {
  let d = source(ops.emptyData(), '2026-10-05', 'income', 'Paycheck', 1000, '2026-10-23', { type: 'biweekly' }, 'pay');
  d = source(d, '2026-10-05', 'bill', 'Rent', 900, '2026-10-25', { type: 'monthly' }, 'rent');
  return d;
}

/**
 * Two clients and four jobs:
 * - logo (Acme, $800, done), payment expected Oct 28;
 * - copy (Birch, $1,200, planned), payment possible Nov 15;
 * - brochure (Acme, $300, done), no payment date;
 * - poster (no client, $150, done), payment expected Oct 12, so overdue.
 */
function freelance(): AppData {
  let d = unwrap(ops.addClient(baseline(), 'Acme', SETUP, 'acme'));
  d = unwrap(ops.addClient(d, 'Birch', SETUP, 'birch'));
  d = unwrap(ops.addJob(d, { description: 'Logo design', clientId: 'acme', amountCents: usd(800), status: 'done', expectedDate: '2026-10-28' }, SETUP, 'logo'));
  d = unwrap(ops.addJob(d, { description: 'Website copy', clientId: 'birch', amountCents: usd(1200), status: 'planned', expectedDate: '2026-11-15', certainty: 'possible' }, SETUP, 'copy'));
  d = unwrap(ops.addJob(d, { description: 'Brochure', clientId: 'acme', amountCents: usd(300), status: 'done' }, SETUP, 'brochure'));
  d = unwrap(ops.addJob(d, { description: 'Poster', amountCents: usd(150), status: 'done', expectedDate: '2026-10-12' }, SETUP, 'poster'));
  return d;
}

const job = (d: AppData, id: string) => d.jobs!.find((j) => j.id === id)!;
const payment = (d: AppData, id: string) => d.records.find((r) => r.id === job(d, id).paymentRecordId);
const entries = (f: Forecast, d: AppData, id: string) => f.entries.filter((e) => e.occurrence.id === job(d, id).paymentRecordId);
const state = (d: AppData, id: string, today = TODAY) => {
  const v = jobView(d, job(d, id), today);
  return [v.status, v.payment, v.amountCents, v.date];
};

describe('planned, done, paid, overdue, possible and pending', () => {
  it('each job reads as its work and its payment', () => {
    const d = freelance();
    expect(state(d, 'logo')).toEqual(['done', 'expected', usd(800), '2026-10-28']);
    expect(state(d, 'copy')).toEqual(['planned', 'possible', usd(1200), '2026-11-15']);
    expect(state(d, 'brochure')).toEqual(['done', 'pending', usd(300), null]);
    expect(state(d, 'poster')).toEqual(['done', 'overdue', usd(150), '2026-10-12']);
    // A job without a date has no record; the others have one each, labeled with the client.
    expect(job(d, 'brochure').paymentRecordId).toBeUndefined();
    expect(d.records.map((r) => r.description)).toEqual(['Logo design · Acme', 'Website copy · Birch', 'Poster']);
  });

  it('only a dated, expected payment counts: never because the work is done', () => {
    const d = freelance();
    const f = buildForecast(d, TODAY);
    expect(entries(f, d, 'logo')).toEqual([expect.objectContaining({ date: '2026-10-28', signedCents: usd(800), counts: true })]);
    expect(entries(f, d, 'copy')).toEqual([expect.objectContaining({ date: '2026-11-15', signedCents: 0, counts: false, possible: true })]);
    // Overdue: carried to the forecast start like any late income.
    expect(entries(f, d, 'poster')).toEqual([expect.objectContaining({ date: '2026-10-23', signedCents: usd(150), counts: true, carriedForward: true })]);
    expect(overdueEntries(f).map((e) => e.occurrence.description)).toEqual(['Poster']);
    expect(homeView(d, TODAY).attention.map((i) => i.id)).toContain(job(d, 'poster').paymentRecordId);
    // October income: the baseline plus $800 and $150; the done $300 brochure and the possible copy add nothing.
    const base = buildForecast(baseline(), TODAY);
    expect(periodKpis(f, '2026-10-01', '2026-10-31').incomeCents - periodKpis(base, '2026-10-01', '2026-10-31').incomeCents).toBe(usd(950));
    expect(periodKpis(f, '2026-11-01', '2026-11-30')).toEqual(periodKpis(base, '2026-11-01', '2026-11-30'));
  });

  it('done but unpaid work is earned, not received, counted once per job', () => {
    const d = freelance();
    const notPaid = doneNotPaid(d, TODAY);
    expect(notPaid.jobs.map((v) => v.job.id)).toEqual(['logo', 'brochure', 'poster']);
    expect(notPaid.cents).toBe(usd(800 + 300 + 150));
    expect(activityView(buildForecast(d, TODAY), '2026-10-01', '2026-10-31').items).toEqual([]);
  });
});

describe('getting paid: recorded once, at the recorded date and amount', () => {
  it('a job with a date: its payment record is recorded and the original expectation kept', () => {
    const at = clockAt('2026-10-27');
    const d = unwrap(ops.recordJobPayment(freelance(), 'logo', { amountCents: usd(780), date: '2026-10-27' }, at));
    expect(state(d, 'logo', '2026-10-27')).toEqual(['paid', 'received', usd(780), '2026-10-27']);
    expect(payment(d, 'logo')).toMatchObject({ expectedDate: '2026-10-28', expectedAmountCents: usd(800), actualDate: '2026-10-27', actualAmountCents: usd(780), status: 'completed' });
    const f = buildForecast(d, '2026-10-27');
    expect(entries(f, d, 'logo')).toEqual([expect.objectContaining({ date: '2026-10-27', signedCents: usd(780), counts: true })]);
    expect(activityView(f, '2026-10-01', '2026-10-31').items.map((i) => [i.entry.occurrence.description, i.entry.amountCents])).toEqual([['Logo design · Acme', usd(780)]]);
    expect(doneNotPaid(d, '2026-10-27').jobs.map((v) => v.job.id)).toEqual(['brochure', 'poster']);
    expect(ops.recordJobPayment(d, 'logo', { amountCents: usd(780), date: '2026-10-27' }, at)).toEqual({ ok: false, error: 'This job is already paid.' });
  });

  it('a pending job: recording its payment makes one record, expected at the job amount on that date', () => {
    const d = unwrap(ops.recordJobPayment(freelance(), 'brochure', { amountCents: usd(320), date: '2026-10-18' }, clock));
    expect(payment(d, 'brochure')).toMatchObject({ description: 'Brochure · Acme', expectedDate: '2026-10-18', expectedAmountCents: usd(300), actualAmountCents: usd(320), status: 'completed' });
    expect(entries(buildForecast(d, TODAY), d, 'brochure')).toEqual([expect.objectContaining({ date: '2026-10-18', signedCents: usd(320), counts: true })]);
    // A planned job is done once paid.
    const planned = unwrap(ops.recordJobPayment(freelance(), 'copy', { amountCents: usd(1200), date: TODAY }, clock));
    expect(job(planned, 'copy').status).toBe('done');
  });

  it("recording through the app's usual ways (the payment's sheet, a batch) pays the job too, and undoing it unpays it", () => {
    const plan = freelance();
    let d = unwrap(ops.recordAsExpected(plan, [job(plan, 'poster').paymentRecordId!], clock));
    expect(state(d, 'poster')).toEqual(['paid', 'received', usd(150), '2026-10-12']);
    d = unwrap(ops.restoreOccurrence(d, job(d, 'poster').paymentRecordId!, clock));
    expect(state(d, 'poster')).toEqual(['done', 'overdue', usd(150), '2026-10-12']);
  });

  it('a possible payment is marked expected with E1 and then counts on its date', () => {
    const plan = freelance();
    const d = unwrap(ops.setIncomeCertainty(plan, job(plan, 'copy').paymentRecordId!, 'expected', clock));
    expect(state(d, 'copy')).toEqual(['planned', 'expected', usd(1200), '2026-11-15']);
    expect(entries(buildForecast(d, TODAY), d, 'copy')[0]).toMatchObject({ counts: true, signedCents: usd(1200) });
  });

  it('every dollar once: what is received is exactly the recorded payments', () => {
    const at = clockAt('2026-10-30');
    let d = freelance();
    d = unwrap(ops.recordJobPayment(d, 'logo', { amountCents: usd(780), date: '2026-10-27' }, at));
    d = unwrap(ops.recordJobPayment(d, 'brochure', { amountCents: usd(300), date: '2026-10-29' }, at));
    d = unwrap(ops.recordJobPayment(d, 'poster', { amountCents: usd(150), date: '2026-10-20' }, at));
    const received = activityView(buildForecast(d, '2026-10-30'), '2026-10-01', '2026-10-31').items.filter((i) => i.entry.occurrence.sourceId === null);
    expect(received.reduce((n, i) => n + i.entry.signedCents, 0)).toBe(usd(780 + 300 + 150));
    expect(new Set(received.map((i) => i.entry.occurrence.id)).size).toBe(3);
    expect(doneNotPaid(d, '2026-10-30').cents).toBe(0);
  });
});

describe('changing jobs and clients', () => {
  it('a new amount or date moves the payment, keeping the original; removing the date makes it pending; a new date makes a record', () => {
    let d = freelance();
    const id = job(d, 'logo').paymentRecordId!;
    d = unwrap(ops.editJob(d, 'logo', { description: 'Logo design', clientId: 'acme', amountCents: usd(900), status: 'done', expectedDate: '2026-11-02' }, clock));
    expect(payment(d, 'logo')).toMatchObject({ id, expectedDate: '2026-10-28', expectedAmountCents: usd(800), scheduledDate: '2026-11-02', scheduledAmountCents: usd(900) });
    d = unwrap(ops.editJob(d, 'logo', { description: 'Logo design', clientId: 'acme', amountCents: usd(900), status: 'done', expectedDate: null }, clock));
    expect(job(d, 'logo').paymentRecordId).toBeUndefined();
    expect(d.records.some((r) => r.id === id)).toBe(false);
    expect(state(d, 'logo')).toEqual(['done', 'pending', usd(900), null]);
    d = unwrap(ops.editJob(d, 'brochure', { description: 'Brochure', clientId: 'acme', amountCents: usd(300), status: 'done', expectedDate: '2026-11-05', certainty: 'possible' }, clock));
    expect(state(d, 'brochure')).toEqual(['done', 'possible', usd(300), '2026-11-05']);
    // Certainty changes through the job too; omitted means unchanged.
    d = unwrap(ops.editJob(d, 'brochure', { description: 'Brochure', clientId: 'acme', amountCents: usd(300), status: 'done', certainty: 'expected' }, clock));
    expect(state(d, 'brochure')).toEqual(['done', 'expected', usd(300), '2026-11-05']);
  });

  it("a new description or client relabels the payment; a client's new name does too; deleting a client keeps its jobs", () => {
    let d = unwrap(ops.editJob(freelance(), 'logo', { description: 'Logo and icons', clientId: 'birch', amountCents: usd(800), status: 'done' }, clock));
    expect(payment(d, 'logo')!.description).toBe('Logo and icons · Birch');
    d = unwrap(ops.renameClient(d, 'birch', 'Birch & Co', clock));
    expect(payment(d, 'logo')!.description).toBe('Logo and icons · Birch & Co');
    expect(payment(d, 'copy')!.description).toBe('Website copy · Birch & Co');
    d = unwrap(ops.deleteClient(d, 'birch', clock));
    expect(d.clients!.map((c) => c.id)).toEqual(['acme']);
    expect(job(d, 'logo')).not.toHaveProperty('clientId');
    expect(payment(d, 'logo')!.description).toBe('Logo and icons');
    // Amounts and dates are untouched by any of it.
    expect(payment(d, 'logo')).toMatchObject({ scheduledAmountCents: usd(800), scheduledDate: '2026-10-28' });
  });

  it('a paid job keeps its recorded payment; a skipped one must be restored first; deleting removes an unpaid payment only', () => {
    const at = clockAt('2026-10-27');
    let d = unwrap(ops.recordJobPayment(freelance(), 'logo', { amountCents: usd(780), date: '2026-10-27' }, at));
    expectError(ops.editJob(d, 'logo', { description: 'Logo', clientId: 'acme', amountCents: usd(999), status: 'done' }, at), /Correct its recorded payment/);
    expectError(ops.editJob(d, 'logo', { description: 'Logo', clientId: 'acme', amountCents: usd(800), status: 'planned' }, at), /A paid job is done/);
    expect(job(unwrap(ops.editJob(d, 'logo', { description: 'Logo', clientId: 'acme', amountCents: usd(800), status: 'done' }, at)), 'logo').description).toBe('Logo');
    expectError(ops.deleteJob(d, 'logo'), /Undo the payment first/);
    expectError(ops.deleteOneTime(d, job(d, 'logo').paymentRecordId!), /payment for Logo design/);
    // Skipped: not owed, not earned-not-paid, and money changes wait for the skip to be undone.
    d = unwrap(ops.cancelOccurrence(d, job(d, 'poster').paymentRecordId!, '', at));
    expect(state(d, 'poster', '2026-10-27')).toEqual(['done', 'skipped', usd(150), '2026-10-12']);
    expect(doneNotPaid(d, '2026-10-27').jobs.map((v) => v.job.id)).not.toContain('poster');
    expectError(ops.editJob(d, 'poster', { description: 'Poster', amountCents: usd(200), status: 'done' }, at), /Undo the skip/);
    expectError(ops.recordJobPayment(d, 'poster', { amountCents: usd(150), date: '2026-10-27' }, at), /Undo the skip/);
    // Deleting an unpaid job removes its payment record with it.
    const plan = freelance();
    const gone = unwrap(ops.deleteJob(plan, 'copy'));
    expect(gone.records.some((r) => r.id === job(plan, 'copy').paymentRecordId)).toBe(false);
    expect(unwrap(ops.deleteJob(unwrap(ops.deleteJob(unwrap(ops.deleteJob(gone, 'brochure')), 'poster')), 'logo')).jobs).toBeUndefined();
  });

  it('validation: names, amounts, states and clients', () => {
    const d = freelance();
    expectError(ops.addClient(d, ' acme ', clock), /already have a client/);
    expectError(ops.addClient(d, '  ', clock), /Enter a name/);
    expectError(ops.addJob(d, { description: 'X', amountCents: 0, status: 'done' }, clock), /greater than \$0/);
    expectError(ops.addJob(d, { description: 'X', amountCents: 100, status: 'paid' as never }, clock), /planned or done/);
    expectError(ops.addJob(d, { description: 'X', amountCents: 100, status: 'done', clientId: 'nope' }, clock), /client no longer exists/);
    expectError(ops.addJob(d, { description: ' ', amountCents: 100, status: 'done' }, clock), /description/);
    expectError(ops.renameClient(d, 'acme', 'Birch', clock), /already have a client/);
    expectError(ops.editJob(d, 'nope', { description: 'X', amountCents: 100, status: 'done' }, clock), /no longer exists/);
  });

  it('the forecast reads only payment records: a plan with jobs but no dates is the baseline', () => {
    let d = unwrap(ops.addClient(baseline(), 'Acme', clock, 'acme'));
    d = unwrap(ops.addJob(d, { description: 'Draft', clientId: 'acme', amountCents: usd(5000), status: 'done' }, clock, 'j'));
    const strip = (f: Forecast) => f.entries.map((e) => [e.occurrence.id, e.date, e.signedCents, e.counts]);
    expect(strip(buildForecast(d, TODAY))).toEqual(strip(buildForecast(baseline(), TODAY)));
    expect((d.jobs![0] as FreelanceJob).paymentRecordId).toBeUndefined();
  });
});
