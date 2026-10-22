import * as ops from '../operations';
import type { AppData } from '../types';
import { clockAt, source, unwrap, usd } from './helpers';

// E5 fixture: every kind of earnings data, as of Monday Oct 19, 2026.
const clock = clockAt('2026-10-19');

/**
 * - Server (tipped): paycheck $600 every 2 weeks from Oct 2, $15.25/h. Shifts Sep 28, Oct 13, Oct 14; paychecks recorded Oct 2 ($590) and Oct 16 ($780).
 * - DoorDash payouts (gig): about $400 every Monday from Oct 5. Sessions Oct 6 (DoorDash, $15 cash), Oct 15 (Uber), Oct 17 (DoorDash, no hours); the Oct 12 payout recorded at $85.
 * - Salary (fixed): $2,000 on the 1st, recorded. Never earnings.
 * - Jobs: an old one paid Sep 20; Logo paid Oct 9 ($780); Poster done, no date; Copy planned, possible, Nov 15.
 * - Rent $900 on the 25th.
 */
export function earningsPlan(): AppData {
  let d = unwrap(ops.addSource(ops.emptyData(), { kind: 'income', description: 'Server', amountCents: usd(600), startDate: '2026-10-02', rule: { type: 'biweekly' }, incomeType: 'tipped', hourlyWageCents: 1525 }, clockAt('2026-09-01'), 'job'));
  d = unwrap(ops.addSource(d, { kind: 'income', description: 'DoorDash payouts', amountCents: usd(400), startDate: '2026-10-05', rule: { type: 'weekly' }, incomeType: 'gig' }, clockAt('2026-09-01'), 'dash'));
  d = source(d, '2026-09-01', 'income', 'Salary', 2000, '2026-10-01', { type: 'monthly' }, 'salary');
  d = source(d, '2026-09-01', 'bill', 'Rent', 900, '2026-10-25', { type: 'monthly' }, 'rent');
  const shift = (id: string, date: string, hours: number, cash: number | null, card: number | null) =>
    (d = unwrap(ops.logShift(d, { sourceId: 'job', date, minutes: hours * 60, wageCents: 1525, cashTipsCents: cash === null ? null : usd(cash), cardTipsCents: card === null ? null : usd(card) }, clock, id)));
  shift('s3', '2026-09-28', 4, 20, null);
  shift('s1', '2026-10-13', 6.5, 40, 55);
  shift('s2', '2026-10-14', 5, null, 30);
  const session = (id: string, date: string, hours: number | null, earnings: number, cash: number | null, platform: string) =>
    (d = unwrap(ops.logSession(d, { sourceId: 'dash', date, minutes: hours === null ? null : hours * 60, earningsCents: usd(earnings), cashTipsCents: cash === null ? null : usd(cash), platform }, clock, id)));
  session('g1', '2026-10-06', 3, 90, 15, 'DoorDash');
  session('g2', '2026-10-15', 2, 60, null, 'Uber');
  session('g3', '2026-10-17', null, 40, null, 'DoorDash');
  d = unwrap(ops.recordActual(d, 'job@2026-10-02', { amountCents: usd(590), date: '2026-10-02' }, clock));
  d = unwrap(ops.recordActual(d, 'job@2026-10-16', { amountCents: usd(780), date: '2026-10-16' }, clock));
  d = unwrap(ops.recordActual(d, 'dash@2026-10-12', { amountCents: usd(85), date: '2026-10-12' }, clock));
  d = unwrap(ops.recordActual(d, 'salary@2026-10-01', { amountCents: usd(2000), date: '2026-10-01' }, clock));
  d = unwrap(ops.addJob(d, { description: 'Old job', amountCents: usd(300), status: 'done', expectedDate: '2026-09-20' }, clock, 'old'));
  d = unwrap(ops.recordJobPayment(d, 'old', { amountCents: usd(300), date: '2026-09-20' }, clock));
  d = unwrap(ops.addJob(d, { description: 'Logo', amountCents: usd(800), status: 'done', expectedDate: '2026-10-10' }, clock, 'logo'));
  d = unwrap(ops.recordJobPayment(d, 'logo', { amountCents: usd(780), date: '2026-10-09' }, clock));
  d = unwrap(ops.addJob(d, { description: 'Poster', amountCents: usd(150), status: 'done' }, clock, 'poster'));
  d = unwrap(ops.addJob(d, { description: 'Copy', amountCents: usd(1200), status: 'planned', expectedDate: '2026-11-15', certainty: 'possible' }, clock, 'copy'));
  return d;
}

