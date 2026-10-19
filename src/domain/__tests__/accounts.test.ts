import { describe, expect, it } from 'vitest';
import { buildForecast, dailyTimeline, periodKpis, timingGapsAhead } from '../forecast';
import * as ops from '../operations';
import type { AccountType, AppData } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

const TODAY = '2026-10-11';
const clock = clockAt(TODAY);

function withAccounts(): AppData {
  let d = ops.emptyData();
  d = unwrap(ops.addAccount(d, { name: 'Paycheck account', type: 'income' }, clock, 'acct-income'));
  d = unwrap(ops.addAccount(d, { name: 'Reserves', type: 'distribution' }, clock, 'acct-reserves'));
  d = unwrap(ops.addAccount(d, { name: 'Bills', type: 'payment' }, clock, 'acct-bills'));
  return d;
}

function plan(d: AppData = ops.emptyData()): AppData {
  d = source(d, TODAY, 'income', 'Paycheck', 1800, '2026-10-15', { type: 'biweekly' }, 'pay');
  d = source(d, TODAY, 'bill', 'Rent', 1200, '2026-10-20', { type: 'monthly' }, 'rent');
  d = source(d, TODAY, 'subscription', 'Streaming', 15, '2026-10-22', { type: 'monthly' }, 'stream');
  d = source(d, TODAY, 'liability', 'Car loan', 350, '2026-10-26', { type: 'monthly' }, 'car');
  d = source(d, TODAY, 'reserve', 'Emergency fund', 100, '2026-10-16', { type: 'biweekly' }, 'save');
  return unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Car repair', amountCents: usd(700), date: '2026-10-31' }, clock, 'repair'));
}

describe('creating accounts', () => {
  it('creates income, distribution and payment accounts with the person’s own names', () => {
    const d = withAccounts();
    expect(d.accounts).toEqual([
      { id: 'acct-income', name: 'Paycheck account', type: 'income', createdAt: clock.now, updatedAt: clock.now },
      { id: 'acct-reserves', name: 'Reserves', type: 'distribution', createdAt: clock.now, updatedAt: clock.now },
      { id: 'acct-bills', name: 'Bills', type: 'payment', createdAt: clock.now, updatedAt: clock.now },
    ]);
  });

  it('allows several accounts of the same type', () => {
    let d = withAccounts();
    d = unwrap(ops.addAccount(d, { name: 'Everyday spending', type: 'payment' }, clock));
    d = unwrap(ops.addAccount(d, { name: 'Housing', type: 'payment' }, clock));
    expect(d.accounts!.filter((a) => a.type === 'payment').map((a) => a.name)).toEqual(['Bills', 'Everyday spending', 'Housing']);
  });

  it('rejects an unknown type, and an empty, too long or repeated name', () => {
    const d = withAccounts();
    for (const type of ['spending', 'reserve', 'routing', ''] as unknown as AccountType[]) {
      expect(ops.addAccount(d, { name: 'X', type }, clock)).toEqual({ ok: false, error: 'Choose income, distribution or payment.' });
    }
    expect(ops.addAccount(d, { name: '   ', type: 'payment' }, clock)).toEqual({ ok: false, error: 'Enter a name for the account.' });
    expect(ops.addAccount(d, { name: 'x'.repeat(61), type: 'payment' }, clock)).toMatchObject({ ok: false });
    expect(ops.addAccount(d, { name: ' bills ', type: 'payment' }, clock)).toEqual({ ok: false, error: 'You already have an account with that name.' });
    // Trimmed, and up to the limit.
    expect(unwrap(ops.addAccount(d, { name: '  Housing  ', type: 'payment' }, clock)).accounts!.at(-1)!.name).toBe('Housing');
    let many = ops.emptyData();
    for (let i = 0; i < ops.MAX_ACCOUNTS; i++) many = unwrap(ops.addAccount(many, { name: `Account ${i}`, type: 'payment' }, clock));
    expect(ops.addAccount(many, { name: 'One more', type: 'payment' }, clock)).toEqual({ ok: false, error: `You can have up to ${ops.MAX_ACCOUNTS} accounts.` });
  });

  it('renames an account without changing its id, type or assignments', () => {
    let d = plan(withAccounts());
    d = unwrap(ops.assignAccount(d, 'rent', 'acct-bills', clock));
    const later = clockAt('2026-10-12');
    d = unwrap(ops.renameAccount(d, 'acct-bills', 'Obligations', later));
    expect(d.accounts!.find((a) => a.id === 'acct-bills')).toEqual({ id: 'acct-bills', name: 'Obligations', type: 'payment', createdAt: clock.now, updatedAt: later.now });
    expect(d.sources.find((s) => s.id === 'rent')!.accountId).toBe('acct-bills');
    expect(ops.renameAccount(d, 'acct-bills', 'Reserves', later)).toEqual({ ok: false, error: 'You already have an account with that name.' });
    expect(ops.renameAccount(d, 'missing', 'X', later)).toEqual({ ok: false, error: 'That account no longer exists.' });
    // Renaming to the same name with different capitals is allowed.
    expect(unwrap(ops.renameAccount(d, 'acct-bills', 'OBLIGATIONS', later)).accounts!.find((a) => a.id === 'acct-bills')!.name).toBe('OBLIGATIONS');
  });
});

describe('assigning items to accounts', () => {
  it('assigns each kind to the account type that suits it, and can clear it', () => {
    let d = plan(withAccounts());
    d = unwrap(ops.assignAccount(d, 'pay', 'acct-income', clock));
    for (const id of ['rent', 'stream', 'car', 'repair']) d = unwrap(ops.assignAccount(d, id, 'acct-bills', clock));
    d = unwrap(ops.assignAccount(d, 'save', 'acct-reserves', clock));
    expect(Object.fromEntries(d.sources.map((s) => [s.id, s.accountId]))).toEqual({ pay: 'acct-income', rent: 'acct-bills', stream: 'acct-bills', car: 'acct-bills', save: 'acct-reserves' });
    expect(d.records.find((r) => r.id === 'repair')!.accountId).toBe('acct-bills');

    d = unwrap(ops.assignAccount(d, 'rent', null, clock));
    expect('accountId' in d.sources.find((s) => s.id === 'rent')!).toBe(false);
  });

  it('refuses an account whose type doesn’t suit the item, and unknown items or accounts', () => {
    const d = plan(withAccounts());
    expect(ops.assignAccount(d, 'pay', 'acct-bills', clock)).toEqual({ ok: false, error: 'Income goes to an income account.' });
    expect(ops.assignAccount(d, 'rent', 'acct-income', clock)).toEqual({ ok: false, error: 'Payments come from a payment account.' });
    expect(ops.assignAccount(d, 'rent', 'acct-reserves', clock)).toEqual({ ok: false, error: 'Payments come from a payment account.' });
    expect(ops.assignAccount(d, 'save', 'acct-bills', clock)).toEqual({ ok: false, error: 'Strategic reserves are held in a distribution account.' });
    expect(ops.assignAccount(d, 'rent', 'missing', clock)).toEqual({ ok: false, error: 'That account no longer exists.' });
    expect(ops.assignAccount(d, 'missing', 'acct-bills', clock)).toEqual({ ok: false, error: 'That item no longer exists.' });
    // A recurring occurrence follows its item; it can't be assigned on its own.
    expect(ops.assignAccount(d, 'rent@2026-10-20', 'acct-bills', clock)).toEqual({ ok: false, error: 'That item no longer exists.' });
  });

  it('changes only the assigned item', () => {
    const d = plan(withAccounts());
    const later = clockAt('2026-10-12');
    const after = unwrap(ops.assignAccount(d, 'rent', 'acct-bills', later));
    const rent = after.sources.find((s) => s.id === 'rent')!;
    const { accountId: _a, updatedAt: _u, ...rest } = rent;
    const { updatedAt: _v, ...before } = d.sources.find((s) => s.id === 'rent')!;
    expect(rest).toEqual(before);
    expect(rent.updatedAt).toBe(later.now);
    expect(after.sources.filter((s) => s.id !== 'rent')).toEqual(d.sources.filter((s) => s.id !== 'rent'));
    expect(after.records).toEqual(d.records);
    expect(after.accounts).toEqual(d.accounts);
    // Assigning the same account again changes nothing.
    expect(unwrap(ops.assignAccount(after, 'rent', 'acct-bills', clockAt('2026-10-13')))).toBe(after);
  });

  it('a recorded payment keeps the account it was paid from; moving the item later moves only what is still expected', () => {
    let d = unwrap(ops.addAccount(plan(withAccounts()), { name: 'Housing', type: 'payment' }, clock, 'acct-housing'));
    d = unwrap(ops.assignAccount(d, 'rent', 'acct-bills', clock));
    d = unwrap(ops.recordActual(d, 'rent@2026-10-20', { amountCents: usd(1200), date: '2026-10-20' }, clockAt('2026-10-20')));
    expect(d.records.find((r) => r.id === 'rent@2026-10-20')).toMatchObject({ status: 'completed', accountId: 'acct-bills' });
    d = unwrap(ops.assignAccount(d, 'rent', 'acct-housing', clockAt('2026-10-21')));
    expect(d.records.find((r) => r.id === 'rent@2026-10-20')!.accountId).toBe('acct-bills');
    // Undone, it is outstanding again and follows the item.
    d = unwrap(ops.restoreOccurrence(d, 'rent@2026-10-20', clockAt('2026-10-21')));
    expect(d.records.find((r) => r.id === 'rent@2026-10-20')).toBeUndefined();
  });
});

describe('accounts and the forecast', () => {
  it('creating and assigning accounts changes no forecast result', () => {
    const base = plan();
    let withAll = plan(withAccounts());
    withAll = unwrap(ops.assignAccount(withAll, 'pay', 'acct-income', clock));
    withAll = unwrap(ops.assignAccount(withAll, 'rent', 'acct-bills', clock));
    withAll = unwrap(ops.assignAccount(withAll, 'save', 'acct-reserves', clock));
    withAll = unwrap(ops.assignAccount(withAll, 'repair', 'acct-bills', clock));
    const a = buildForecast(base, TODAY);
    const b = buildForecast(withAll, TODAY);
    const strip = (f: typeof a) => f.entries.map((e) => [e.occurrence.id, e.date, e.signedCents, e.counts]);
    expect(strip(b)).toEqual(strip(a));
    expect([b.anchor, b.forecastStart]).toEqual([a.anchor, a.forecastStart]);
    // Every day's money and running total (the rows embed the items themselves, whose account and edit time differ).
    const days = (f: typeof a) => dailyTimeline(f, '2026-10-01', '2026-12-31').map((r) => [r.date, r.inCents, r.outCents, r.netCents, r.tallyCents, r.entries.map((e) => e.occurrence.id)]);
    expect(days(b)).toEqual(days(a));
    expect(periodKpis(b, '2026-10-01', '2026-10-31')).toEqual(periodKpis(a, '2026-10-01', '2026-10-31'));
    expect(timingGapsAhead(b)).toEqual(timingGapsAhead(a));
  });

  it('starting over erases accounts with everything else', () => {
    const d = unwrap(ops.startOver(unwrap(ops.assignAccount(plan(withAccounts()), 'rent', 'acct-bills', clock))));
    expect(d.accounts).toBeUndefined();
    expect(d.sources).toEqual([]);
  });
});
