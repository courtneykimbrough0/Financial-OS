/**
 * Account balances: where the person's money is, as opposed to cash flow over
 * a period. A balance is known only from an account's opening balance (what
 * the person reported it held at the end of a day); without one the app never
 * states a balance. Pure functions over the same data as the forecast.
 *
 * Recorded balance at the end of `date`:
 *   opening
 *   + recorded income assigned to the account
 *   − recorded payments assigned to it (bills, subscriptions, liabilities,
 *     varied spending)
 *   + recorded transfers into it − recorded transfers out of it
 * counting activity after the opening day through `date`.
 *
 * Projected balance adds what is still expected after the opening day through
 * `date`: outstanding items assigned to the account and expected transfers,
 * including ones whose date has passed without being recorded. It is an
 * estimate and is always labeled as one.
 *
 * Strategic Reserve items never change a balance: an allocation says money is
 * set aside, and the money moves only when a transfer moves it. Counting both
 * would count it twice. Transfers never change cash flow, income or spending,
 * and every transfer changes two balances by the same amount, so the total
 * across accounts is unchanged by it.
 */
import type { DateStr } from './dates';
import { buildForecast } from './forecast';
import type { Cents } from './money';
import type { Account, AppData, Occurrence, Transfer } from './types';

/** The account an occurrence belongs to: its source's for a recurring one, its own for a one-time one. */
export function accountOf(data: AppData, o: Pick<Occurrence, 'sourceId' | 'accountId'>): string | null {
  if (o.sourceId === null) return o.accountId ?? null;
  return data.sources.find((s) => s.id === o.sourceId)?.accountId ?? null;
}

/** How an item of this kind moves its account's balance: income in, payments out, reserves not at all. */
function balanceSign(kind: Occurrence['kind']): 1 | -1 | 0 {
  return kind === 'income' ? 1 : kind === 'reserve' ? 0 : -1;
}

function transferEffect(t: Transfer, accountId: string): Cents {
  return t.toAccountId === accountId ? t.amountCents : t.fromAccountId === accountId ? -t.amountCents : 0;
}

export interface AccountBalance {
  accountId: string;
  /** Recorded balance at the end of `date`. */
  recordedCents: Cents;
  /** Recorded balance plus everything still expected through `date`: an estimate. */
  projectedCents: Cents;
  /** Expected activity counted in the projection that is dated before today and not yet recorded. */
  unrecordedPastCount: number;
}

/**
 * The account's balances at the end of `date`, or null when it has no
 * opening balance on or before that date (the app doesn't know).
 */
export function accountBalance(data: AppData, accountId: string, date: DateStr, today: DateStr): AccountBalance | null {
  const account = (data.accounts ?? []).find((a) => a.id === accountId);
  return account ? balanceOf(data, account, date, today) : null;
}

function balanceOf(data: AppData, account: Account, date: DateStr, today: DateStr): AccountBalance | null {
  const opening = account.opening;
  if (!opening || opening.date > date) return null;
  const after = (d: DateStr) => d > opening.date && d <= date;
  let recorded = opening.amountCents;
  let expected = 0;
  let unrecordedPast = 0;

  // Items: recorded at their actual date, outstanding at their latest expected date.
  const forecast = buildForecast(data, today, { through: date });
  for (const e of forecast.entries) {
    const o = e.occurrence;
    if (!e.counts || accountOf(data, o) !== account.id) continue;
    const sign = balanceSign(o.kind);
    if (sign === 0) continue;
    if (o.status === 'completed') {
      if (after(e.date)) recorded += sign * e.amountCents;
    } else if (after(o.scheduledDate)) {
      expected += sign * e.amountCents;
      if (o.scheduledDate < today) unrecordedPast += 1;
    }
  }

  for (const t of data.transfers ?? []) {
    const effect = transferEffect(t, account.id);
    if (effect === 0) continue;
    if (t.status === 'recorded') {
      if (after(t.date)) recorded += effect;
    } else if (after(t.date)) {
      expected += effect;
      if (t.date < today) unrecordedPast += 1;
    }
  }
  return { accountId: account.id, recordedCents: recorded, projectedCents: recorded + expected, unrecordedPastCount: unrecordedPast };
}

/**
 * For an expected transfer: how far its source account is projected to fall
 * below $0 on the transfer's date (or today, if that has passed), counting
 * the transfer itself. 0 when it is covered; null when the source has no
 * opening balance, so the app can't tell. Nothing is moved to cover it.
 */
export function transferShortfall(data: AppData, transferId: string, today: DateStr): Cents | null {
  const t = (data.transfers ?? []).find((x) => x.id === transferId);
  if (!t || t.status !== 'expected') return null;
  const when = t.date < today ? today : t.date;
  const b = accountBalance(data, t.fromAccountId, when, today);
  if (!b) return null;
  return b.projectedCents < 0 ? -b.projectedCents : 0;
}

/** Transfers dated in [start, end], in date order (recorded before expected on the same day). */
export function transfersInRange(data: AppData, start: DateStr, end: DateStr): Transfer[] {
  return (data.transfers ?? [])
    .filter((t) => t.date >= start && t.date <= end)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.status !== b.status ? (a.status === 'recorded' ? -1 : 1) : b.amountCents - a.amountCents || (a.id < b.id ? -1 : 1)));
}

export interface TransfersDue {
  /** Expected transfers dated today or earlier: not recorded yet. */
  attention: Transfer[];
  /** Expected transfers after today through `end`. */
  upcoming: Transfer[];
}

/** Expected transfers to act on, oldest first. A passed date never marks one done. */
export function transfersDue(data: AppData, today: DateStr, end: DateStr): TransfersDue {
  const expected = transfersInRange(data, '0000-01-01', end).filter((t) => t.status === 'expected');
  return { attention: expected.filter((t) => t.date <= today), upcoming: expected.filter((t) => t.date > today) };
}

/** Every transfer touching the account, newest first. */
export function accountTransfers(data: AppData, accountId: string): Transfer[] {
  return transfersInRange(data, '0000-01-01', '9999-12-31')
    .filter((t) => t.fromAccountId === accountId || t.toAccountId === accountId)
    .reverse();
}
