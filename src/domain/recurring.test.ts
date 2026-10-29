import { describe, expect, it } from 'vitest';
import { detectRecurring, type RecurringInput } from './recurring';

let n = 0;
const txn = (posted_on: string, dollars: number, display_description: string, account_id = 'chk'): RecurringInput => ({
  id: `t${n++}`,
  posted_on,
  amount_cents: -Math.round(dollars * 100),
  display_description,
  category_id: 'cat',
  account_id,
});
const monthly = (desc: string, dollars: number, months: string[], day = '15') =>
  months.map((m) => txn(`${m}-${day}`, dollars, desc));

describe('detectRecurring', () => {
  it('finds a fixed monthly subscription, with its next charge and monthly cost', () => {
    const [s] = detectRecurring(monthly('Netflix', 15.49, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']), '2026-10-20');
    expect(s).toMatchObject({
      label: 'Netflix',
      cadence: 'monthly',
      typicalCents: 1549,
      monthlyCents: 1549,
      varies: false,
      last: '2026-10-15',
      next: '2026-11-14',
      overdue: false,
    });
    expect(s.transactions[0].posted_on).toBe('2026-10-15'); // newest first
  });

  it('finds variable bills (utilities) and says they vary', () => {
    const bills = [
      txn('2026-06-03', 98.2, 'Georgia Power'),
      txn('2026-07-02', 141.75, 'GEORGIA POWER'),
      txn('2026-08-04', 162.1, 'Georgia Power'),
      txn('2026-09-02', 120.4, 'Georgia Power'),
    ];
    const [s] = detectRecurring(bills, '2026-09-10');
    expect(s.cadence).toBe('monthly');
    expect(s.varies).toBe(true);
    expect(s.label).toBe('Georgia Power'); // commonest spelling
  });

  it('recognises weekly, every-2-weeks, quarterly and yearly cadences', () => {
    const weekly = ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'].map((d) => txn(d, 30, 'Lawn Care'));
    const biweekly = ['2026-08-01', '2026-08-15', '2026-08-29', '2026-09-12'].map((d) => txn(d, 60, 'Cleaner'));
    const quarterly = ['2026-01-10', '2026-04-10', '2026-07-10'].map((d) => txn(d, 90, 'Pest Control'));
    const yearly = ['2024-03-01', '2025-03-01', '2026-03-02'].map((d) => txn(d, 120, 'Amazon Prime'));
    const found = Object.fromEntries(
      detectRecurring([...weekly, ...biweekly, ...quarterly, ...yearly], '2026-10-23').map((s) => [s.label, s.cadence]),
    );
    expect(found).toEqual({
      'Lawn Care': 'weekly',
      Cleaner: 'biweekly',
      'Pest Control': 'quarterly',
      'Amazon Prime': 'yearly',
    });
  });

  it('ignores irregular shopping and one-off purchases', () => {
    const shopping = ['2026-06-02', '2026-06-05', '2026-07-19', '2026-07-21', '2026-09-30'].map((d) => txn(d, 40, 'Target'));
    const once = [txn('2026-08-10', 500, 'Furniture Store')];
    expect(detectRecurring([...shopping, ...once], '2026-10-01')).toEqual([]);
  });

  it('tolerates one late or skipped charge', () => {
    const late = monthly('StreamCo', 11.99, ['2026-04', '2026-05', '2026-06', '2026-08', '2026-09']); // July skipped
    expect(detectRecurring(late, '2026-09-20').map((s) => s.label)).toEqual(['StreamCo']);
  });

  it('flags a subscription whose expected charge is well overdue', () => {
    const [s] = detectRecurring(monthly('Gym', 40, ['2026-03', '2026-04', '2026-05', '2026-06']), '2026-08-20');
    expect(s.overdue).toBe(true);
  });

  it('counts several charges on one day as one occasion', () => {
    const doubled = [...monthly('Hulu', 8, ['2026-07', '2026-08', '2026-09']), txn('2026-09-15', 8, 'Hulu')];
    const [s] = detectRecurring(doubled, '2026-09-20');
    expect(s.cadence).toBe('monthly');
  });

  it('puts the largest monthly cost first, comparing across cadences', () => {
    const found = detectRecurring(
      [
        ...monthly('Phone', 60, ['2026-07', '2026-08', '2026-09']),
        ...['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].map((d) => txn(d, 25, 'Daycare snack')),
      ],
      '2026-09-23',
    );
    expect(found.map((s) => s.label)).toEqual(['Daycare snack', 'Phone']); // ~$109/month vs $60
  });

  it("judges 'overdue' against the account's newest data, not today's date", () => {
    const gym = monthly('Gym', 40, ['2026-03', '2026-04', '2026-05', '2026-06']);
    // Today is late August, but this account was last imported on 2026-06-20.
    expect(detectRecurring(gym, () => '2026-06-20')[0].overdue).toBe(false);
    expect(detectRecurring(gym, () => '2026-08-20')[0].overdue).toBe(true);
  });
});

