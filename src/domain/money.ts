/**
 * Money is stored and calculated as integer cents (USD minor units) so sums
 * never accumulate floating-point error.
 */

export type Cents = number;

/**
 * Parses user input such as "1,650", "$1650.5" or "1650.50" into cents.
 * Returns null for empty, malformed, or more-than-two-decimal input.
 */
export function parseMoney(input: string): Cents | null {
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const m = /^(-)?(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return null;
  const whole = Number(m[2] || '0');
  const frac = Number((m[3] ?? '').padEnd(2, '0'));
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] ? -cents : cents;
}

const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$1,650.00" / "−$230.00" (uses a true minus sign for readability). */
export function formatMoney(cents: Cents): string {
  const abs = formatter.format(Math.abs(cents) / 100);
  return cents < 0 ? `−${abs}` : abs;
}

/** "+$1,650.00" / "−$230.00" / "$0.00" */
export function formatSignedMoney(cents: Cents): string {
  if (cents === 0) return formatMoney(0);
  return cents > 0 ? `+${formatMoney(cents)}` : formatMoney(cents);
}

/** A money-in total: "+$1,650.00", or "$0.00" when there is none. */
export function formatMoneyIn(cents: Cents): string {
  return cents === 0 ? formatMoney(0) : `+${formatMoney(cents)}`;
}

/** A money-out total (given as a positive amount): "−$230.00", or "$0.00" when there is none. */
export function formatMoneyOut(cents: Cents): string {
  return cents === 0 ? formatMoney(0) : `−${formatMoney(cents)}`;
}

/** Value suitable for pre-filling an amount input: "1650.00". */
export function centsToInput(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Compact calendar label: "$1.6k", "$85", "$12.5k". */
export function formatCompact(cents: Cents): string {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? '−' : '';
  if (dollars >= 1000) {
    const k = dollars / 1000;
    return `${sign}$${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return `${sign}$${Math.round(dollars)}`;
}
