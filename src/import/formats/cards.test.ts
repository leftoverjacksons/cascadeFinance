import { describe, expect, it } from 'vitest';
import { parseCsv } from '../parse';

// Invented rows in the two card formats (not real data).
const amex = [
  'Date,Description,Amount',
  '10/07/2026,RENEWAL MEMBERSHIP FEE,95.00',
  '08/09/2026,ONLINE PAYMENT - THANK YOU,-120.00',
  '07/06/2026,Example Air         DALLAS              TX,312.40',
  '06/26/2026,SP EXAMPLE SHOES    SANTA BARBARA       CA,88.10',
  '06/20/2026,EXAMPLE AIR LINES   ATLANTA,150.00',
  '05/15/2026,Shopco              866-555-0100        MA,45.25',
].join('\n');

const discover = [
  'Trans. Date,Post Date,Description,Amount,Category',
  '06/10/2025,06/12/2025,"BAL TRANS FEE",90.00,"Fees"',
  '06/12/2025,06/12/2025,"EXAMPLE BANK ******1234BT IAPR 0.00% EXPIRES 12/2026",3000.00,"Balance Transfers"',
  '06/30/2025,06/30/2025,"INTERNET PAYMENT - THANK YOU",-150.00,"Payments and Credits"',
  '09/13/2025,09/13/2025,"FIRST LATE PAYMENT - NO FEE",0.00,"Fees"',
  '11/16/2025,11/16/2025,"INTEREST CHARGE ON PURCHASES",0.37,"Interest"',
].join('\n');

describe('American Express', () => {
  const { format, rows, errors } = parseCsv(amex);

  it('is recognised from its header', () => expect(format.id).toBe('amex_card'));

  it('flips amounts: charges are money out, payments money in', () => {
    expect(errors).toEqual([]);
    expect(rows.find((r) => r.raw_description.startsWith('RENEWAL'))!.amount_cents).toBe(-9500);
    expect(rows.find((r) => r.raw_description.startsWith('ONLINE PAYMENT'))!.amount_cents).toBe(12000);
  });

  it('reads MM/DD/YYYY dates; everything is posted', () => {
    expect(rows[0]).toMatchObject({ posted_on: '2026-10-07', status: 'posted', bank_category: null });
  });

  it('keeps the merchant from the fixed-width field, and the original as raw', () => {
    const names = rows.map((r) => r.display_description);
    expect(names).toContain('Example Air');
    expect(names).toContain('Sp Example Shoes');
    expect(names).toContain('Example Air Lines');
    expect(names).toContain('Shopco');
    expect(names).toContain('Online Payment - Thank You');
    expect(rows.find((r) => r.display_description === 'Example Air')!.raw_description).toBe(
      'Example Air         DALLAS              TX',
    );
  });
});

describe('Discover', () => {
  const { format, rows, errors } = parseCsv(discover);

  it('is recognised from its header', () => expect(format.id).toBe('discover_card'));

  it('uses the post date, flips amounts and keeps the category', () => {
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ posted_on: '2025-06-12', amount_cents: -9000, bank_category: 'Fees' });
    expect(rows.find((r) => r.bank_category === 'Payments and Credits')!.amount_cents).toBe(15000);
  });

  it('skips $0.00 notices instead of reporting them as errors', () => {
    expect(rows.some((r) => r.raw_description.includes('NO FEE'))).toBe(false);
    expect(rows).toHaveLength(4);
  });
});
