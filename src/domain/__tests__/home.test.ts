import { describe, expect, it } from 'vitest';
import { buildForecast, periodKpis } from '../forecast';
import { homeView, type HomeItem } from '../home';
import * as ops from '../operations';
import type { AppData } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

// Tuesday. This week is Sun Oct 11 – Sat Oct 17; "coming up" runs through Tue Oct 20;
// a timing gap needs attention when it starts by Mon Oct 19 (7 days, today included).
const TODAY = '2026-10-13';
const SETUP = '2026-09-01';
const clock = clockAt(TODAY);
const at = (date: string) => clockAt(date);
const ids = (items: HomeItem[]) => items.map((i) => i.id);

/** Pay $1,000 on the 5th, rent $600 on the 10th, from September; September recorded as expected. */
function monthly(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1000, '2026-09-05', { type: 'monthly' }, 'pay');
  d = source(d, SETUP, 'bill', 'Rent', 600, '2026-09-10', { type: 'monthly' }, 'rent');
  d = unwrap(ops.recordActual(d, 'pay@2026-09-05', { amountCents: usd(1000), date: '2026-09-05' }, at('2026-09-05')));
  return unwrap(ops.recordActual(d, 'rent@2026-09-10', { amountCents: usd(600), date: '2026-09-10' }, at('2026-09-10')));
}

function withOctober(payDollars: number): AppData {
  let d = unwrap(ops.recordActual(monthly(), 'pay@2026-10-05', { amountCents: usd(payDollars), date: '2026-10-05' }, at('2026-10-05')));
  d = unwrap(ops.recordActual(d, 'rent@2026-10-10', { amountCents: usd(600), date: '2026-10-10' }, at('2026-10-10')));
  return unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Haircut', amountCents: usd(50), date: '2026-10-20' }, clock, 'haircut'));
}

describe('progress', () => {
  it('compares recorded cash flow month to date with the same days of last month: up', () => {
    const p = homeView(withOctober(1100), TODAY).progress;
    expect(p.monthToDate).toEqual({
      basis: 'month-to-date-recorded',
      current: { start: '2026-10-01', end: '2026-10-13', netCents: usd(500), count: 2 },
      previous: { start: '2026-09-01', end: '2026-09-13', netCents: usd(400), count: 2 },
      differenceCents: usd(100),
      direction: 'up',
    });
  });

  it('down and unchanged follow the sign alone, with no threshold', () => {
    expect(homeView(withOctober(900), TODAY).progress.monthToDate).toMatchObject({ differenceCents: usd(-100), direction: 'down' });
    expect(homeView(withOctober(1000), TODAY).progress.monthToDate).toMatchObject({ differenceCents: 0, direction: 'unchanged' });
    expect(homeView(withOctober(1000.01), TODAY).progress.monthToDate).toMatchObject({ differenceCents: 1, direction: 'up' });
  });

  it('keeps recorded and projected apart, and labels a projected-versus-recorded comparison as such', () => {
    const p = homeView(withOctober(1100), TODAY).progress;
    // October: recorded $1,100 − $600; still expected: the $50 haircut.
    expect([p.thisMonth.recorded.netCents, p.thisMonth.projected.netCents, p.thisMonth.expectedCount]).toEqual([usd(500), usd(450), 1]);
    expect([p.lastMonth.recorded.netCents, p.lastMonth.projected.netCents, p.lastMonth.expectedCount]).toEqual([usd(400), usd(400), 0]);
    expect(p.projectedVsLastMonth).toMatchObject({ basis: 'projected-vs-recorded', differenceCents: usd(50), direction: 'up' });
  });

  it("uses the forecast's own figures: a month's projection equals periodKpis for it", () => {
    const d = withOctober(1100);
    const f = buildForecast(d, TODAY);
    expect(homeView(d, TODAY).progress.thisMonth.projected).toEqual(periodKpis(f, '2026-10-01', '2026-10-31'));
  });

  it('compares the 31st with the last day of a shorter month', () => {
    const p = homeView(ops.emptyData(), '2026-03-31').progress;
    expect([p.monthToDate.current.end, p.monthToDate.previous.start, p.monthToDate.previous.end]).toEqual(['2026-03-31', '2026-02-01', '2026-02-28']);
  });

  it('counts reserves as reserves, never as spending, with releases subtracted', () => {
    let d = withOctober(1100);
    d = unwrap(ops.addOneTime(d, { kind: 'reserve', description: 'Emergency fund', amountCents: usd(200), date: '2026-10-11' }, at('2026-10-11'), 'set'));
    d = unwrap(ops.recordActual(d, 'set', { amountCents: usd(200), date: '2026-10-11' }, clock));
    d = unwrap(ops.addOneTime(d, { kind: 'reserve', description: 'Toward the repair', amountCents: usd(80), date: '2026-10-12', release: true }, at('2026-10-12'), 'use'));
    d = unwrap(ops.recordActual(d, 'use', { amountCents: usd(80), date: '2026-10-12' }, clock));
    const r = homeView(d, TODAY).progress.thisMonth.recorded;
    expect(r).toEqual({ incomeCents: usd(1100), outflowCents: usd(600), reservesCents: usd(120), operatingCents: usd(500), netCents: usd(380) });
  });
});

/** Pay $900 every 2 weeks from Fri Oct 16 and $150 weekly from Mon Sep 7; phone $60 on the 12th; a $40 one-time due today. */
function week(): AppData {
  let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 900, '2026-10-16', { type: 'biweekly' }, 'pay');
  d = source(d, SETUP, 'income', 'Side job', 150, '2026-09-07', { type: 'weekly' }, 'side');
  d = source(d, SETUP, 'bill', 'Phone', 60, '2026-10-12', { type: 'monthly' }, 'phone');
  d = source(d, SETUP, 'reserve', 'Emergency fund', 100, '2026-10-18', { type: 'monthly' }, 'fund');
  for (const date of ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']) d = unwrap(ops.recordActual(d, `side@${date}`, { amountCents: usd(150), date }, at(date)));
  // This week's side-job pay came a day late and $20 short.
  d = unwrap(ops.recordActual(d, 'side@2026-10-12', { amountCents: usd(130), date: '2026-10-13' }, clock));
  return unwrap(ops.addOneTime(d, { kind: 'varied', description: 'School trip', amountCents: usd(40), date: TODAY }, at(SETUP), 'trip'));
}

describe('needs attention', () => {
  it('lists overdue items first, then items due today; expected items are never treated as done', () => {
    const v = homeView(week(), TODAY);
    const items = v.attention.filter((i) => i.type === 'occurrence');
    expect(items.map((i) => [i.id, i.type === 'occurrence' && i.overdue, i.type === 'occurrence' && i.entry.occurrence.status])).toEqual([
      ['phone@2026-10-12', true, 'scheduled'],
      ['trip', false, 'scheduled'],
    ]);
  });

  it('includes an overdue item from an earlier week', () => {
    let d = week();
    d = source(d, SETUP, 'bill', 'Water', 30, '2026-09-25', { type: 'monthly' }, 'water');
    expect(ids(homeView(d, TODAY).attention).slice(0, 2)).toEqual(['water@2026-09-25', 'phone@2026-10-12']);
  });

  it('is empty when nothing is due, and is never padded', () => {
    let d = week();
    d = unwrap(ops.recordActual(d, 'phone@2026-10-12', { amountCents: usd(60), date: '2026-10-12' }, clock));
    d = unwrap(ops.recordActual(d, 'trip', { amountCents: usd(40), date: TODAY }, clock));
    expect(homeView(d, TODAY).attention).toEqual([]);
  });
});

/** A $100 paycheck tomorrow, then a $500 one-time payment on `date`: a timing gap from that day. */
function gapOn(date: string): AppData {
  const d = source(ops.emptyData(), TODAY, 'income', 'Paycheck', 100, '2026-10-14', { type: 'monthly' }, 'pay');
  return unwrap(ops.addOneTime(d, { kind: 'varied', description: 'Repair', amountCents: usd(500), date }, clock, 'repair'));
}

describe('timing gaps', () => {
  it('a gap starting on the 7th day (today included) needs attention', () => {
    const v = homeView(gapOn('2026-10-19'), TODAY);
    expect(ids(v.attention)).toEqual(['gap@2026-10-19']);
    expect(v.comingUp.some((i) => i.type === 'gap')).toBe(false);
  });

  it('a gap starting the day after is coming up; one beyond the window stays available as a later gap', () => {
    const soon = homeView(gapOn('2026-10-20'), TODAY);
    expect(soon.attention).toEqual([]);
    expect(soon.comingUp.filter((i) => i.type === 'gap').map((i) => i.id)).toEqual(['gap@2026-10-20']);
    const later = homeView(gapOn('2026-10-28'), TODAY);
    expect([later.attention, later.comingUp.filter((i) => i.type === 'gap')]).toEqual([[], []]);
    expect(later.laterGaps.map((g) => [g.id, g.gap.lowestCents])).toEqual([['gap@2026-10-28', usd(-400)]]);
  });

  it('once their dates pass unrecorded, the paycheck and the repair need attention as overdue; the running total from today leaves them out', () => {
    const d = gapOn('2026-10-15');
    expect(ids(homeView(d, '2026-10-16').attention)).toEqual(['pay@2026-10-14', 'repair']);
  });
});

describe('coming up', () => {
  it('lists expected income from several sources, obligations and reserves after today through early next week, in date order', () => {
    const v = homeView(week(), TODAY);
    expect(v.week).toEqual({ start: '2026-10-11', end: '2026-10-17', current: true, comingUpThrough: '2026-10-20' });
    expect(v.comingUp.map((i) => [i.date, i.id])).toEqual([
      ['2026-10-16', 'pay@2026-10-16'],
      ['2026-10-18', 'fund@2026-10-18'],
      ['2026-10-19', 'side@2026-10-19'],
    ]);
    const fund = v.comingUp.find((i) => i.id === 'fund@2026-10-18')!;
    expect(fund.type === 'occurrence' && fund.entry.signedCents).toBe(usd(-100));
  });

  it('never repeats an item that needs attention, and nothing appears in two sections', () => {
    const v = homeView(week(), TODAY);
    const all = [...ids(v.attention), ...ids(v.comingUp), ...ids(v.happened)];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('happened this week', () => {
  it('lists what was recorded this week with any difference from what was expected', () => {
    const v = homeView(week(), TODAY);
    expect(v.happened).toHaveLength(1);
    const side = v.happened[0]!;
    expect(side.type === 'occurrence' && [side.id, side.date, side.variance]).toEqual(['side@2026-10-12', '2026-10-13', { amountCents: usd(-20), days: 1 }]);
    // Last week's recorded pay isn't this week's.
    expect(ids(v.happened)).not.toContain('side@2026-10-05');
  });

  it('includes a recorded reserve release with its sign', () => {
    let d = week();
    d = unwrap(ops.addOneTime(d, { kind: 'reserve', description: 'Toward the trip', amountCents: usd(40), date: TODAY, release: true }, clock, 'use'));
    d = unwrap(ops.recordActual(d, 'use', { amountCents: usd(40), date: TODAY }, clock));
    const use = homeView(d, TODAY).happened.find((i) => i.id === 'use')!;
    expect(use.type === 'occurrence' && use.entry.signedCents).toBe(usd(40));
  });
});

describe('transfers', () => {
  function withTransfers(): AppData {
    let d = week();
    d = unwrap(ops.addAccount(d, { name: 'Paycheck account', type: 'income' }, at(SETUP), 'acct-in'));
    d = unwrap(ops.addAccount(d, { name: 'Bills', type: 'payment' }, at(SETUP), 'acct-bills'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'acct-in', toAccountId: 'acct-bills', amountCents: usd(60), date: '2026-10-12' }, 'expected', clock, 'due'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'acct-in', toAccountId: 'acct-bills', amountCents: usd(300), date: '2026-10-16' }, 'expected', clock, 'planned'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'acct-in', toAccountId: 'acct-bills', amountCents: usd(25), date: '2026-10-11' }, 'recorded', clock, 'moved'));
    d = unwrap(ops.addTransfer(d, { fromAccountId: 'acct-in', toAccountId: 'acct-bills', amountCents: usd(25), date: '2026-10-05' }, 'recorded', clock, 'last-week'));
    return unwrap(ops.addTransfer(d, { fromAccountId: 'acct-in', toAccountId: 'acct-bills', amountCents: usd(25), date: '2026-10-28' }, 'expected', clock, 'far'));
  }

  it('a planned transfer whose date passed needs attention; later planned ones are coming up; recorded ones this week happened', () => {
    const v = homeView(withTransfers(), TODAY);
    expect(v.attention.filter((i) => i.type === 'transfer').map((i) => i.id)).toEqual(['due']);
    expect(v.comingUp.filter((i) => i.type === 'transfer').map((i) => i.id)).toEqual(['planned']);
    expect(v.happened.filter((i) => i.type === 'transfer').map((i) => i.id)).toEqual(['moved']);
    const due = v.attention.find((i) => i.id === 'due')!;
    expect(due.type === 'transfer' && [due.transfer.status, due.shortfallCents]).toEqual(['expected', null]);
  });

  it("shows a planned transfer's shortfall when its source balance is known", () => {
    const d = unwrap(ops.setOpeningBalance(withTransfers(), 'acct-in', { amountCents: usd(20), date: '2026-10-10' }, clock));
    const due = homeView(d, TODAY).attention.find((i) => i.id === 'due')!;
    // $20 − $25 recorded on Oct 11 − $60 planned = −$65.
    expect(due.type === 'transfer' && due.shortfallCents).toBe(usd(65));
  });

  it('never changes any cash-flow figure', () => {
    const a = homeView(week(), TODAY);
    const b = homeView(withTransfers(), TODAY);
    expect(b.progress).toEqual(a.progress);
    const occurrences = (items: HomeItem[]) => items.filter((i) => i.type !== 'transfer');
    expect(occurrences(b.attention)).toEqual(occurrences(a.attention));
    expect(occurrences(b.comingUp).map((i) => i.id)).toEqual(occurrences(a.comingUp).map((i) => i.id));
  });
});

describe('accounts on items', () => {
  it("upcoming items carry their item's account; recorded ones the account they were recorded in", () => {
    let d = week();
    d = unwrap(ops.addAccount(d, { name: 'Paycheck account', type: 'income' }, at(SETUP), 'acct-in'));
    d = unwrap(ops.addAccount(d, { name: 'Side account', type: 'income' }, at(SETUP), 'acct-side'));
    d = unwrap(ops.assignAccount(d, 'side', 'acct-in', clock));
    d = unwrap(ops.restoreOccurrence(d, 'side@2026-10-12', clock));
    d = unwrap(ops.recordActual(d, 'side@2026-10-12', { amountCents: usd(130), date: TODAY }, clock));
    d = unwrap(ops.assignAccount(d, 'side', 'acct-side', clock));
    const v = homeView(d, TODAY);
    const accountOfId = (items: HomeItem[], id: string) => {
      const i = items.find((x) => x.id === id)!;
      return i.type === 'occurrence' ? i.accountId : undefined;
    };
    expect(accountOfId(v.happened, 'side@2026-10-12')).toBe('acct-in');
    expect(accountOfId(v.comingUp, 'side@2026-10-19')).toBe('acct-side');
    expect(accountOfId(v.comingUp, 'pay@2026-10-16')).toBeNull();
  });
});

describe('the viewed week', () => {
  const base = homeView(week(), TODAY);
  const view = (weekOf: string) => homeView(week(), TODAY, { weekOf });

  it('defaults to the current week', () => {
    expect(homeView(week(), TODAY, { weekOf: TODAY })).toEqual(base);
    expect(homeView(week(), TODAY, { weekOf: '2026-10-11' })).toEqual(base);
  });

  it('moving the week never changes progress, what is overdue or what needs attention', () => {
    for (const weekOf of ['2026-10-04', '2026-10-20', '2026-11-03', '2027-02-10']) {
      const v = view(weekOf);
      expect(v.today).toBe(TODAY);
      expect(v.progress).toEqual(base.progress);
      expect(v.attention).toEqual(base.attention);
    }
  });

  it('the next week lists its own expected items, after today, and takes no early days of the week after', () => {
    const v = view('2026-10-20');
    expect(v.week).toEqual({ start: '2026-10-18', end: '2026-10-24', current: false, comingUpThrough: '2026-10-24' });
    expect(v.comingUp.map((i) => [i.date, i.id])).toEqual([
      ['2026-10-18', 'fund@2026-10-18'],
      ['2026-10-19', 'side@2026-10-19'],
    ]);
    expect(v.happened).toEqual([]);
  });

  it('a week further ahead starts at its first day, not at tomorrow', () => {
    const v = view('2026-10-27');
    expect(v.comingUp.map((i) => i.id)).toEqual(['side@2026-10-26', 'pay@2026-10-30']);
    expect(v.comingUp.every((i) => i.date >= '2026-10-25' && i.date <= '2026-10-31')).toBe(true);
  });

  it('the previous week lists what was recorded then, and nothing coming up', () => {
    const v = view('2026-10-07');
    expect(v.week).toMatchObject({ start: '2026-10-04', end: '2026-10-10', current: false });
    expect(v.happened.map((i) => i.id)).toEqual(['side@2026-10-05']);
    expect(v.comingUp).toEqual([]);
  });

  it('an item recorded this week is not in last week, and a past week keeps its own record', () => {
    expect(base.happened.map((i) => i.id)).toEqual(['side@2026-10-12']);
    expect(view('2026-10-07').happened.map((i) => i.id)).not.toContain('side@2026-10-12');
  });

  it('crosses a month boundary', () => {
    const v = homeView(week(), '2026-10-29', { weekOf: '2026-11-03' });
    expect(v.week).toMatchObject({ start: '2026-11-01', end: '2026-11-07', current: false });
    expect(v.progress.thisMonth.start).toBe('2026-10-01');
  });

  it('crosses a year boundary', () => {
    let d = source(ops.emptyData(), SETUP, 'income', 'Paycheck', 1000, '2026-12-05', { type: 'monthly' }, 'pay');
    d = source(d, SETUP, 'bill', 'Rent', 700, '2026-12-30', { type: 'monthly' }, 'rent');
    const today = '2026-12-30';
    const current = homeView(d, today);
    expect(current.week).toMatchObject({ start: '2026-12-27', end: '2027-01-02', current: true });
    expect(ids(current.attention)).toContain('rent@2026-12-30');
    const next = homeView(d, today, { weekOf: '2027-01-04' });
    expect(next.week).toMatchObject({ start: '2027-01-03', end: '2027-01-09', current: false });
    expect(next.comingUp.map((i) => i.id)).toEqual(['pay@2027-01-05']);
    expect(next.attention).toEqual(current.attention);
  });

  it('gaps follow the viewed week; later ones stay available', () => {
    const d = gapOn('2026-10-28');
    const next = homeView(d, TODAY, { weekOf: '2026-10-27' });
    expect(next.comingUp.filter((i) => i.type === 'gap').map((i) => i.id)).toEqual(['gap@2026-10-28']);
    expect(next.laterGaps).toEqual([]);
    const current = homeView(d, TODAY);
    expect(current.laterGaps.map((g) => g.id)).toEqual(['gap@2026-10-28']);
  });

  it("reads the same forecast: a viewed week's totals reconcile with periodKpis", () => {
    const f = buildForecast(week(), TODAY, { through: '2026-10-31' });
    const v = view('2026-10-20');
    const expected = v.comingUp.filter((i) => i.type === 'occurrence').reduce((n, i) => n + (i.type === 'occurrence' ? i.entry.signedCents : 0), 0);
    expect(expected).toBe(periodKpis(f, '2026-10-18', '2026-10-24').netCents);
  });
});

describe('empty and deterministic', () => {
  it('an empty plan has empty sections and zero progress', () => {
    const v = homeView(ops.emptyData(), TODAY);
    expect([v.attention, v.comingUp, v.happened, v.laterGaps]).toEqual([[], [], [], []]);
    expect([v.progress.monthToDate.differenceCents, v.progress.monthToDate.direction, v.progress.thisMonth.expectedCount]).toEqual([0, 'unchanged', 0]);
  });

  it('gives the same result every time, however the data is stored', () => {
    const d = week();
    const shuffled = { ...d, sources: [...d.sources].reverse(), records: [...d.records].reverse() };
    expect(homeView(shuffled, TODAY)).toEqual(homeView(d, TODAY));
    expect(homeView(d, TODAY)).toEqual(homeView(d, TODAY));
  });
});
