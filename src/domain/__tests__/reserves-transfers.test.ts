import { describe, expect, it } from 'vitest';
import { accountBalance, accountTransfers, transferShortfall, transfersDue, transfersInRange } from '../balances';
import { buildForecast, dailyTimeline, periodKpis, timingGapsAhead } from '../forecast';
import * as ops from '../operations';
import { periodPlan } from '../plan';
import type { AppData } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

const TODAY = '2026-10-11';
const clock = clockAt(TODAY);

/** Three accounts: where pay lands, where reserves are held, where bills are paid from. */
function accounts(d: AppData = ops.emptyData()): AppData {
  d = unwrap(ops.addAccount(d, { name: 'Paycheck account', type: 'income' }, clock, 'income'));
  d = unwrap(ops.addAccount(d, { name: 'Reserves', type: 'distribution' }, clock, 'reserves'));
  d = unwrap(ops.addAccount(d, { name: 'Routing', type: 'distribution' }, clock, 'routing'));
  d = unwrap(ops.addAccount(d, { name: 'Bills', type: 'payment' }, clock, 'bills'));
  return d;
}

/** The worked example: $4,000 in, $2,800 paid out, $500 set aside in October. */
function example(): AppData {
  let d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 2000, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 2000, '2026-10-20', { type: 'monthly' }, 'rent');
  d = source(d, TODAY, 'liability', 'Car loan', 500, '2026-10-22', { type: 'monthly' }, 'car');
  d = source(d, TODAY, 'subscription', 'Streaming', 100, '2026-10-24', { type: 'monthly' }, 'stream');
  d = unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Groceries', amountCents: usd(200), date: '2026-10-25' }, clock, 'groceries'));
  d = source(d, TODAY, 'reserve', 'Emergency fund', 250, '2026-10-16', { type: 'biweekly' }, 'reserve');
  return d;
}

describe('Strategic Reserves in cash flow', () => {
  it('the worked example: operating $1,200, reserves $500, available $700', () => {
    const k = periodKpis(buildForecast(example(), TODAY), '2026-10-01', '2026-10-31');
    expect(k).toEqual({ incomeCents: usd(4000), outflowCents: usd(2800), reservesCents: usd(500), operatingCents: usd(1200), netCents: usd(700) });
    const p = periodPlan(buildForecast(example(), TODAY), '2026-10-01', '2026-10-31');
    expect([p.incomeCents, p.outflowCents, p.reservesCents, p.operatingCents, p.cashFlowCents]).toEqual([usd(4000), usd(2800), usd(500), usd(1200), usd(700)]);
  });

  it('a reserve allocation lowers the running total like a payment, and is never counted as spending', () => {
    const f = buildForecast(example(), TODAY);
    const day = dailyTimeline(f, '2026-10-16', '2026-10-16')[0]!;
    expect([day.inCents, day.outCents, day.reservedCents, day.netCents]).toEqual([0, 0, usd(250), usd(-250)]);
    expect(day.tallyCents).toBe(usd(2000 - 250));
    // Each entry lands in exactly one part, so the parts add up to the net.
    for (const r of dailyTimeline(f, '2026-10-01', '2026-12-31')) expect(r.inCents - r.outCents - r.reservedCents).toBe(r.netCents);
  });

  it('recording a reserve allocation counts it once, at what was actually set aside', () => {
    let d = example();
    d = unwrap(ops.recordActual(d, 'reserve@2026-10-16', { amountCents: usd(300), date: '2026-10-11' }, clock));
    const k = periodKpis(buildForecast(d, TODAY), '2026-10-01', '2026-10-31');
    expect([k.outflowCents, k.reservesCents]).toEqual([usd(2800), usd(550)]);
  });

  it('a release returns money to available cash flow and reduces net reserves', () => {
    let d = example();
    d = unwrap(ops.addOneTime(d, { kind: 'reserve', description: 'Toward car repair', amountCents: usd(400), date: '2026-10-26', release: true }, clock, 'use'));
    expect(d.records.find((r) => r.id === 'use')!.release).toBe(true);
    const f = buildForecast(d, TODAY);
    const k = periodKpis(f, '2026-10-01', '2026-10-31');
    expect(k).toEqual({ incomeCents: usd(4000), outflowCents: usd(2800), reservesCents: usd(100), operatingCents: usd(1200), netCents: usd(1100) });
    const day = dailyTimeline(f, '2026-10-26', '2026-10-26')[0]!;
    expect([day.inCents, day.reservedCents, day.netCents]).toEqual([0, usd(-400), usd(400)]);
    // Never external income.
    expect(periodPlan(f, '2026-10-01', '2026-10-31').incomeCents).toBe(usd(4000));
  });

  it('only a one-time reserve can be a release; the flag is absent otherwise', () => {
    const d = unwrap(ops.addOneTime(ops.emptyData(), { kind: 'reserve', description: 'Bonus set aside', amountCents: usd(500), date: TODAY }, clock, 'r'));
    expect('release' in d.records[0]!).toBe(false);
    expect(ops.addOneTime(ops.emptyData(), { kind: 'income', description: 'X', amountCents: 100, date: TODAY, release: true }, clock)).toEqual({ ok: false, error: 'Only a strategic reserve can be released.' });
  });
});

describe('transfers between accounts', () => {
  it('records a transfer between two different accounts with a positive amount', () => {
    const d = unwrap(ops.addTransfer(accounts(), { fromAccountId: 'income', toAccountId: 'reserves', amountCents: usd(500), date: TODAY }, 'recorded', clock, 't1'));
    expect(d.transfers).toEqual([
      { id: 't1', fromAccountId: 'income', toAccountId: 'reserves', amountCents: usd(500), date: TODAY, status: 'recorded', recordedAt: clock.now, createdAt: clock.now, updatedAt: clock.now },
    ]);
  });

  it('allows every route between two of the person’s accounts, including corrections back', () => {
    const routes: [string, string][] = [
      ['income', 'reserves'], // income → distribution
      ['income', 'bills'], // income → payment
      ['routing', 'reserves'], // distribution → distribution
      ['reserves', 'bills'], // distribution → payment
      ['bills', 'routing'], // a correction back
      ['reserves', 'income'],
    ];
    for (const [from, to] of routes) expect(ops.addTransfer(accounts(), { fromAccountId: from, toAccountId: to, amountCents: 100, date: TODAY }, 'expected', clock).ok).toBe(true);
  });

  it('refuses the same account, a missing account, a non-positive amount, a bad date, or a future recorded one', () => {
    const d = accounts();
    const t = (over: Partial<ops.TransferInput>, status: 'expected' | 'recorded' = 'expected') =>
      ops.addTransfer(d, { fromAccountId: 'income', toAccountId: 'bills', amountCents: 100, date: TODAY, ...over }, status, clock);
    expect(t({ toAccountId: 'income' })).toEqual({ ok: false, error: 'Choose two different accounts.' });
    expect(t({ fromAccountId: 'gone' })).toEqual({ ok: false, error: 'Choose the account the money comes from.' });
    expect(t({ toAccountId: 'gone' })).toEqual({ ok: false, error: 'Choose the account the money goes to.' });
    for (const amountCents of [0, -100, 1.5]) expect(t({ amountCents })).toMatchObject({ ok: false });
    expect(t({ date: '2026-02-30' })).toEqual({ ok: false, error: 'Enter a valid date.' });
    expect(t({ date: '2026-10-12' }, 'recorded')).toEqual({ ok: false, error: 'A transfer can be recorded once it has happened. Plan it as expected instead.' });
    expect(ops.addTransfer(ops.emptyData(), { fromAccountId: 'a', toAccountId: 'b', amountCents: 100, date: TODAY }, 'expected', clock)).toMatchObject({ ok: false });
  });

  it('never creates income or spending, and leaves the forecast exactly as it was', () => {
    const base = example();
    let d = accounts(base);
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'income', toAccountId: 'reserves', amountCents: usd(250), date: '2026-10-16' }, 'expected', clock));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'income', toAccountId: 'bills', amountCents: usd(2000), date: TODAY }, 'recorded', clock));
    const a = buildForecast(base, TODAY);
    const b = buildForecast(d, TODAY);
    expect(b.entries).toEqual(a.entries);
    expect(periodKpis(b, '2026-10-01', '2026-12-31')).toEqual(periodKpis(a, '2026-10-01', '2026-12-31'));
    expect(dailyTimeline(b, '2026-10-01', '2026-12-31').map((r) => r.tallyCents)).toEqual(dailyTimeline(a, '2026-10-01', '2026-12-31').map((r) => r.tallyCents));
    expect(timingGapsAhead(b)).toEqual(timingGapsAhead(a));
  });

  it('an expected transfer stays expected after its date passes, until it is recorded', () => {
    let d = unwrap(ops.addTransfer(accounts(), { fromAccountId: 'income', toAccountId: 'reserves', amountCents: usd(250), date: '2026-10-08' }, 'expected', clock, 'late'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'income', toAccountId: 'bills', amountCents: usd(900), date: '2026-10-14' }, 'expected', clock, 'soon'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'income', toAccountId: 'bills', amountCents: usd(100), date: '2026-10-01' }, 'recorded', clock, 'done'));
    const due = transfersDue(d, '2026-10-20', '2026-10-24');
    expect(due.attention.map((t) => [t.id, t.status])).toEqual([
      ['late', 'expected'],
      ['soon', 'expected'],
    ]);
    expect(due.upcoming).toEqual([]);
    expect(transfersDue(d, TODAY, '2026-10-17').upcoming.map((t) => t.id)).toEqual(['soon']);
  });

  it('records an expected transfer with what actually moved, once', () => {
    let d = unwrap(ops.addTransfer(accounts(), { fromAccountId: 'income', toAccountId: 'reserves', amountCents: usd(250), date: '2026-10-08' }, 'expected', clock, 't'));
    const later = clockAt('2026-10-12');
    d = unwrap(ops.recordTransfer(d, 't', { amountCents: usd(240), date: '2026-10-09' }, later));
    expect(d.transfers![0]).toMatchObject({ status: 'recorded', amountCents: usd(240), date: '2026-10-09', recordedAt: later.now, createdAt: clock.now });
    expect(ops.recordTransfer(d, 't', { amountCents: usd(240), date: '2026-10-09' }, later)).toEqual({ ok: false, error: 'This transfer has already been recorded.' });
    expect(ops.recordTransfer(d, 'gone', { amountCents: 1, date: TODAY }, later)).toEqual({ ok: false, error: 'That transfer no longer exists.' });
  });

  it('a recorded transfer can be corrected or deleted, and stays recorded when corrected', () => {
    let d = unwrap(ops.addTransfer(accounts(), { fromAccountId: 'income', toAccountId: 'reserves', amountCents: usd(250), date: '2026-10-08' }, 'recorded', clock, 't'));
    const later = clockAt('2026-10-12');
    d = unwrap(ops.updateTransfer(d, 't', { fromAccountId: 'income', toAccountId: 'routing', amountCents: usd(260), date: '2026-10-07' }, later));
    expect(d.transfers![0]).toMatchObject({ toAccountId: 'routing', amountCents: usd(260), date: '2026-10-07', status: 'recorded', recordedAt: clock.now, updatedAt: later.now });
    expect(ops.updateTransfer(d, 't', { fromAccountId: 'income', toAccountId: 'routing', amountCents: usd(260), date: '2026-10-20' }, later)).toMatchObject({ ok: false });
    d = unwrap(ops.deleteTransfer(d, 't'));
    expect('transfers' in d).toBe(false);
    expect(ops.deleteTransfer(d, 't')).toEqual({ ok: false, error: 'That transfer no longer exists.' });
  });

  it('lists transfers in date order, and an account’s transfers newest first', () => {
    let d = accounts();
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'income', toAccountId: 'reserves', amountCents: 300, date: '2026-10-09' }, 'recorded', clock, 'b'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'routing', toAccountId: 'bills', amountCents: 200, date: '2026-10-02' }, 'recorded', clock, 'a'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'reserves', toAccountId: 'bills', amountCents: 100, date: '2026-10-20' }, 'expected', clock, 'c'));
    expect(transfersInRange(d, '2026-10-01', '2026-10-31').map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(transfersInRange(d, '2026-10-03', '2026-10-19').map((t) => t.id)).toEqual(['b']);
    expect(accountTransfers(d, 'reserves').map((t) => t.id)).toEqual(['c', 'b']);
  });
});

describe('account balances', () => {
  function withBalances(): AppData {
    let d = accounts(example());
    for (const [id, accountId] of [['pay', 'income'], ['rent', 'bills'], ['car', 'bills'], ['reserve', 'reserves'], ['groceries', 'bills']] as const) d = unwrap(ops.assignAccount(d, id, accountId, clock));
    d = unwrap(ops.setOpeningBalance(d, 'income', { amountCents: usd(100), date: '2026-10-10' }, clock));
    d = unwrap(ops.setOpeningBalance(d, 'reserves', { amountCents: usd(1000), date: '2026-10-10' }, clock));
    d = unwrap(ops.setOpeningBalance(d, 'bills', { amountCents: usd(50), date: '2026-10-10' }, clock));
    return d;
  }

  it('are unknown without an opening balance: the app never guesses', () => {
    expect(accountBalance(accounts(), 'income', TODAY, TODAY)).toBeNull();
    expect(accountBalance(withBalances(), 'income', '2026-10-09', TODAY)).toBeNull();
    expect(accountBalance(withBalances(), 'routing', TODAY, TODAY)).toBeNull();
  });

  it('follow recorded income, payments and transfers after the opening day', () => {
    let d = withBalances();
    const at = clockAt('2026-10-20');
    d = unwrap(ops.recordActual(d, 'pay@2026-10-15', { amountCents: usd(2000), date: '2026-10-15' }, at));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'income', toAccountId: 'bills', amountCents: usd(1900), date: '2026-10-16' }, 'recorded', at));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'income', toAccountId: 'reserves', amountCents: usd(150), date: '2026-10-16' }, 'recorded', at));
    d = unwrap(ops.recordActual(d, 'rent@2026-10-20', { amountCents: usd(2000), date: '2026-10-20' }, at));
    // A recorded reserve allocation changes no balance: only the transfer moves the money.
    d = unwrap(ops.recordActual(d, 'reserve@2026-10-16', { amountCents: usd(250), date: '2026-10-16' }, at));
    const b = (id: string) => accountBalance(d, id, '2026-10-20', '2026-10-20')!.recordedCents;
    expect(b('income')).toBe(usd(100 + 2000 - 1900 - 150));
    expect(b('reserves')).toBe(usd(1000 + 150));
    expect(b('bills')).toBe(usd(50 + 1900 - 2000)); // a legitimate negative balance, kept as recorded
    // Transfers keep the total across accounts the same: only income and payments change it.
    expect(b('income') + b('reserves') + b('bills')).toBe(usd(100 + 1000 + 50 + 2000 - 2000));
  });

  it('activity on or before the opening day is already in the opening balance', () => {
    let d = withBalances();
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'income', toAccountId: 'bills', amountCents: usd(30), date: '2026-10-10' }, 'recorded', clock));
    expect(accountBalance(d, 'income', TODAY, TODAY)!.recordedCents).toBe(usd(100));
  });

  it('project ahead from what is still expected, kept apart from what is recorded', () => {
    let d = withBalances();
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'income', toAccountId: 'bills', amountCents: usd(1900), date: '2026-10-16' }, 'expected', clock, 'fund'));
    const income = accountBalance(d, 'income', '2026-10-20', TODAY)!;
    expect(income).toEqual({ accountId: 'income', recordedCents: usd(100), projectedCents: usd(100 + 2000 - 1900), unrecordedPastCount: 0 });
    const bills = accountBalance(d, 'bills', '2026-10-25', TODAY)!;
    expect(bills.projectedCents).toBe(usd(50 + 1900 - 2000 - 500 - 200));
    // Once the date passes without a record, it is still only expected.
    const late = accountBalance(d, 'income', '2026-10-20', '2026-10-18')!;
    expect(late.recordedCents).toBe(usd(100));
    expect(late.unrecordedPastCount).toBe(2);
  });

  it('show when an expected transfer would leave its source short, without moving anything', () => {
    let d = withBalances();
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'reserves', toAccountId: 'bills', amountCents: usd(1500), date: '2026-10-12' }, 'expected', clock, 'big'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'reserves', toAccountId: 'bills', amountCents: usd(400), date: '2026-10-13' }, 'expected', clock, 'small'));
    expect(transferShortfall(d, 'big', TODAY)).toBe(usd(500));
    expect(transferShortfall(d, 'small', TODAY)).toBe(usd(900));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'routing', toAccountId: 'bills', amountCents: usd(5), date: '2026-10-12' }, 'expected', clock, 'unknown'));
    expect(transferShortfall(d, 'unknown', TODAY)).toBeNull();
    const before = d;
    expect(transferShortfall(d, 'big', TODAY)).toBe(usd(500));
    expect(d).toBe(before);
  });

  it('a covered transfer has no shortfall', () => {
    const d = unwrap(ops.addTransfer(withBalances(), { fromAccountId: 'reserves', toAccountId: 'bills', amountCents: usd(200), date: '2026-10-12' }, 'expected', clock, 'ok'));
    expect(transferShortfall(d, 'ok', TODAY)).toBe(0);
  });

  it('an opening balance may be negative, must be today or earlier, and can be cleared', () => {
    let d = accounts();
    d = unwrap(ops.setOpeningBalance(d, 'bills', { amountCents: usd(-25), date: TODAY }, clock));
    expect(accountBalance(d, 'bills', TODAY, TODAY)!.recordedCents).toBe(usd(-25));
    expect(ops.setOpeningBalance(d, 'bills', { amountCents: 100, date: '2026-10-12' }, clock)).toEqual({ ok: false, error: 'Enter a balance for today or an earlier day.' });
    expect(ops.setOpeningBalance(d, 'bills', { amountCents: 1.5, date: TODAY }, clock)).toEqual({ ok: false, error: 'Enter a balance.' });
    expect(ops.setOpeningBalance(d, 'gone', null, clock)).toEqual({ ok: false, error: 'That account no longer exists.' });
    d = unwrap(ops.setOpeningBalance(d, 'bills', null, clock));
    expect('opening' in d.accounts!.find((a) => a.id === 'bills')!).toBe(false);
  });
});

describe('deleting an account', () => {
  it('an unused account is simply removed', () => {
    const d = unwrap(ops.deleteAccount(accounts(), 'routing', clock));
    expect(d.accounts!.map((a) => a.id)).toEqual(['income', 'reserves', 'bills']);
  });

  it('keeps every item, unassigned, and changes no amount or date', () => {
    let d = accounts(example());
    d = unwrap(ops.assignAccount(d, 'rent', 'bills', clock));
    d = unwrap(ops.assignAccount(d, 'groceries', 'bills', clock));
    expect(ops.assignedCount(d, 'bills')).toBe(2);
    const after = unwrap(ops.deleteAccount(d, 'bills', clockAt('2026-10-12')));
    expect(after.sources.map((s) => s.id)).toEqual(d.sources.map((s) => s.id));
    expect(after.records.map((r) => r.id)).toEqual(d.records.map((r) => r.id));
    expect(after.sources.some((s) => 'accountId' in s) || after.records.some((r) => 'accountId' in r)).toBe(false);
    expect(buildForecast(after, TODAY).entries.map((e) => [e.occurrence.id, e.signedCents])).toEqual(buildForecast(d, TODAY).entries.map((e) => [e.occurrence.id, e.signedCents]));
  });

  it('is refused while a transfer moves money to or from it, so no transfer loses a side', () => {
    let d = unwrap(ops.addTransfer(accounts(), { fromAccountId: 'income', toAccountId: 'bills', amountCents: 100, date: TODAY }, 'recorded', clock, 't'));
    expect(ops.deleteAccount(d, 'bills', clock)).toEqual({ ok: false, error: 'This account has a transfer. Delete or change it first.' });
    d = unwrap(ops.deleteTransfer(d, 't'));
    expect(unwrap(ops.deleteAccount(d, 'bills', clock)).accounts!.map((a) => a.id)).toEqual(['income', 'reserves', 'routing']);
  });

  it('removing the last account leaves no account list', () => {
    let d = unwrap(ops.addAccount(ops.emptyData(), { name: 'Only', type: 'payment' }, clock, 'only'));
    d = unwrap(ops.deleteAccount(d, 'only', clock));
    expect('accounts' in d).toBe(false);
    expect(ops.deleteAccount(d, 'only', clock)).toEqual({ ok: false, error: 'That account no longer exists.' });
  });

  it('starting over removes accounts and transfers with everything else', () => {
    const d = unwrap(ops.addTransfer(accounts(), { fromAccountId: 'income', toAccountId: 'bills', amountCents: 100, date: TODAY }, 'recorded', clock));
    const fresh = unwrap(ops.startOver(d));
    expect([fresh.accounts, fresh.transfers]).toEqual([undefined, undefined]);
  });
});
