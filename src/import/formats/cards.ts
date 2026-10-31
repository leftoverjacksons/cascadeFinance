import { parseAmountToCents } from '../../domain/money';
import type { ImportFormat, NormalizedRow } from '../types';

// Credit card exports. Both list charges as positive amounts and payments and
// credits as negative ones, the opposite of a bank account; amounts are flipped
// so that, as everywhere in the app, negative = money out of the account
// (a purchase) and positive = money in (a payment to the card). That is also
// what lets a card payment pair up with the debit from checking. There is no
// status column (everything is posted) and no balance.

/** MM/DD/YYYY -> YYYY-MM-DD, or null. */
function isoDate(value: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((value ?? '').trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[1]}-${m[2]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** "ONLINE PAYMENT - THANK YOU" -> "Online Payment - Thank You"; mixed case is kept. */
function tidyCase(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s\-/*&(])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function cardRow(dateText: string | undefined, amountText: string | undefined, raw: string, display: string, category: string | null): NormalizedRow | string | null {
  const date = isoDate(dateText);
  if (!date) return `invalid date "${dateText}"`;
  const charge = parseAmountToCents(amountText ?? '');
  if (charge === null) return `invalid amount "${amountText}"`;
  if (charge === 0) return null; // e.g. "FIRST LATE PAYMENT - NO FEE": nothing to record
  if (!raw) return 'missing description';
  return {
    posted_on: date,
    amount_cents: -charge,
    raw_description: raw,
    display_description: display || null,
    bank_category: category,
    status: 'posted',
  };
}

// American Express:
//   Date,Description,Amount
//   03/14/2026,Example Air         DALLAS              TX,312.40
// The description is the merchant in a fixed 20-character field followed by
// the city and state; the display name keeps the merchant part.
export const amexCard: ImportFormat = {
  id: 'amex_card',
  label: 'American Express card',

  matches(header) {
    const h = header.map((x) => x.trim());
    return h.length === 3 && h[0] === 'Date' && h[1] === 'Description' && h[2] === 'Amount';
  },

  parseRecord(r) {
    const raw = (r['Description'] ?? '').trim();
    const merchant = /\s{2,}/.test(raw) ? raw.slice(0, 20).trim() : raw;
    return cardRow(r['Date'], r['Amount'], raw, tidyCase(merchant.replace(/\s+/g, ' ')), null);
  },
};

// Discover:
//   Trans. Date,Post Date,Description,Amount,Category
//   01/02/2026,01/03/2026,"INTERNET PAYMENT - THANK YOU",-150.00,"Payments and Credits"
// The post date is used (it is when a payment matches the debit from checking).
const DISCOVER = ['Trans. Date', 'Post Date', 'Description', 'Amount', 'Category'];

export const discoverCard: ImportFormat = {
  id: 'discover_card',
  label: 'Discover card',

  matches(header) {
    return header.length === DISCOVER.length && header.every((h, i) => h.trim() === DISCOVER[i]);
  },

  parseRecord(r) {
    const raw = (r['Description'] ?? '').trim();
    const display = tidyCase(raw.replace(/\s+/g, ' '));
    return cardRow(r['Post Date'] || r['Trans. Date'], r['Amount'], raw, display, (r['Category'] ?? '').trim() || null);
  },
};
