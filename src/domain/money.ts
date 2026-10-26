// All money is handled as integer cents to avoid floating-point error.

const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatCents(cents: number): string {
  return formatter.format(cents / 100);
}

/**
 * Parses a user- or bank-supplied amount into integer cents.
 * Accepts "1234.5", "-1,234.56", "$1,234.56", "(12.00)" (accounting negative).
 * Returns null for anything that is not a well-formed amount.
 */
export function parseAmountToCents(input: string): number | null {
  let s = input.trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  s = s.replace(/^\$/, '').replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s) ?? /^()\.(\d{1,2})$/.exec(s);
  if (!match) return null;
  const whole = match[1] === '' ? 0 : Number(match[1]);
  const frac = Number((match[2] ?? '').padEnd(2, '0') || '0');
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}
