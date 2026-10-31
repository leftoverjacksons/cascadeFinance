import { describe, expect, it } from 'vitest';
import { detectRecurring, resolver, type RecurringInput } from './recurring';

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
      txn('2026-04-02', 88.1, 'Georgia Power'),
      txn('2026-05-04', 79.6, 'Georgia Power'),
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

  it('splits two subscriptions to one service (one each), interleaved across accounts', () => {
    const months = ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'];
    const charges = [
      ...months.map((m) => txn(`${m}-19`, 20, 'BotCo', 'joint')),
      ...months.map((m) => txn(`${m}-23`, 20, 'BotCo', 'hers')),
    ];
    const found = detectRecurring(charges, '2026-02-25');
    expect(found.map((s) => [s.cadence, s.accountId, s.transactions.length]).sort()).toEqual([
      ['monthly', 'hers', 7],
      ['monthly', 'joint', 7],
    ]);
    expect(new Set(found.map((s) => s.key)).size).toBe(2);
    expect(found.every((s) => s.merchantKey === 'botco')).toBe(true);
  });

  it('splits two subscriptions billed a few days apart from the same account', () => {
    const months = ['2026-04', '2026-05', '2026-06', '2026-07'];
    const charges = [...months.map((m) => txn(`${m}-20`, 20, 'BotCo')), ...months.map((m) => txn(`${m}-23`, 20, 'BotCo'))];
    expect(detectRecurring(charges, '2026-07-25').map((s) => s.cadence)).toEqual(['monthly', 'monthly']);
  });

  it('keeps a subscription that moves to another account as one series', () => {
    const charges = [
      ...['2026-01', '2026-02', '2026-03'].map((m) => txn(`${m}-07`, 20, 'BotCo', 'joint')),
      ...['2026-04', '2026-05', '2026-06'].map((m) => txn(`${m}-07`, 20, 'BotCo', 'his')),
    ];
    const found = detectRecurring(charges, '2026-06-10');
    expect(found).toHaveLength(1);
    expect(found[0].transactions).toHaveLength(6);
  });

  it('still ignores frequent shopping at one store', () => {
    const days = [2, 5, 9, 16, 17, 23, 30, 38, 41, 44, 52, 60, 61, 66, 75, 79, 88, 90, 101, 103, 115, 118];
    const shopping = days.map((d, i) =>
      txn(new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString().slice(0, 10), 20 + (i % 7) * 9, 'MegaMart'),
    );
    expect(detectRecurring(shopping, '2026-05-01')).toEqual([]);
  });

  it('needs a long history before calling varying amounts a bill', () => {
    // Three bakery visits about a month apart, different amounts: not a bill.
    const visits = [txn('2026-07-10', 18.4, 'Bakery'), txn('2026-08-09', 26.1, 'Bakery'), txn('2026-09-08', 21.0, 'Bakery')];
    expect(detectRecurring(visits, '2026-09-20')).toEqual([]);
  });

  it('leaves out series that stopped more than a year ago', () => {
    const old = monthly('OldApp', 9.99, ['2025-03', '2025-04', '2025-05', '2025-06']);
    expect(detectRecurring(old, '2026-10-01')).toEqual([]);
    expect(detectRecurring(old, '2026-05-01')[0].overdue).toBe(true); // within the year: "may have stopped"
  });

  it('treats a renamed merchant as the same one when told ("same as")', () => {
    // Billed as "Widget.ai Subscription" until May, then as "Acme.com".
    const charges = [
      ...['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].map((m) => txn(`${m}-06`, 20, 'Widget.ai Subscription')),
      ...['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => txn(`${m}-06`, 20, 'Acme.com')),
    ];
    const apart = detectRecurring(charges, '2026-10-10');
    expect(apart.map((s) => [s.merchantKey, s.overdue])).toEqual(
      expect.arrayContaining([
        ['widget', true],
        ['acme', false],
      ]),
    );
    const [one, ...rest] = detectRecurring(charges, '2026-10-10', new Map([['widget', 'acme']]));
    expect(rest).toEqual([]);
    expect(one).toMatchObject({ merchantKey: 'acme', aliases: ['widget'], overdue: false });
    expect(one.transactions).toHaveLength(10);
  });
});

describe('resolver', () => {
  it('follows chains of "same as" and stops at loops', () => {
    expect(resolver(new Map([['a', 'b'], ['b', 'c']]))('a')).toBe('c');
    expect(resolver(new Map([['a', 'b'], ['b', 'a']]))('a')).toBe('a');
    expect(resolver(new Map())('a')).toBe('a');
  });
});

