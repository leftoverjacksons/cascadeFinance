import { parseAmountToCents } from '../../domain/money';
import type { ImportFormat } from '../types';

// USAA bank (checking/savings) export, file name bk_download.csv:
//   Date,Description,Original Description,Category,Amount,Status
//   2026-10-23,"Publix","PUBLIX SUPER MAR 3695 C  ATLANTA      GA",Groceries,-137.70,Posted
// Amounts are signed (negative = outflow); there is no account number or balance.
const HEADER = ['Date', 'Description', 'Original Description', 'Category', 'Amount', 'Status'];

export const usaaBank: ImportFormat = {
  id: 'usaa_bank',
  label: 'USAA checking / savings',

  matches(header) {
    return header.length === HEADER.length && header.every((h, i) => h.trim() === HEADER[i]);
  },

  parseRecord(r) {
    const date = r['Date']?.trim() ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      return `invalid date "${date}"`;
    }
    const amount = parseAmountToCents(r['Amount'] ?? '');
    if (amount === null) return `invalid amount "${r['Amount']}"`;

    const original = (r['Original Description'] ?? '').trim();
    const cleaned = (r['Description'] ?? '').trim();
    const raw = original || cleaned;
    if (!raw) return 'missing description';

    const status = (r['Status'] ?? '').trim().toLowerCase();
    if (status !== 'posted' && status !== 'pending') return `unknown status "${r['Status']}"`;

    return {
      posted_on: date,
      amount_cents: amount,
      raw_description: raw,
      display_description: cleaned || null,
      bank_category: (r['Category'] ?? '').trim() || null,
      status,
    };
  },
};
