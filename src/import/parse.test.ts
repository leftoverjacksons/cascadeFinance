import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv, sha256Hex, UnrecognisedFormatError } from './parse';

const sample = readFileSync(new URL('../../tests/fixtures/usaa_bank_sample.csv', import.meta.url), 'utf8');

describe('parseCsv (USAA bank)', () => {
  const result = parseCsv(sample);

  it('detects the format', () => {
    expect(result.format.id).toBe('usaa_bank');
  });

  it('parses every row without errors', () => {
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(7);
  });

  it('normalises a posted row', () => {
    expect(result.rows[1]).toEqual({
      posted_on: '2026-10-23',
      amount_cents: -13770,
      raw_description: 'PUBLIX SUPER MAR 3695 C  ATLANTA      GA',
      display_description: 'Publix',
      bank_category: 'Groceries',
      status: 'posted',
    });
  });

  it('marks pending rows', () => {
    expect(result.rows[0].status).toBe('pending');
  });

  it('keeps identical rows (dedup happens server-side with occurrence numbers)', () => {
    expect(result.rows[2]).toEqual(result.rows[3]);
  });

  it('handles quoted fields containing commas', () => {
    expect(result.rows[4].display_description).toBe('Hardware, Paint & More');
  });

  it('parses credits as positive', () => {
    expect(result.rows[5].amount_cents).toBe(317628);
  });

  it('tolerates a byte-order mark and CRLF line endings', () => {
    const crlf = '﻿' + sample.replace(/\n/g, '\r\n');
    expect(parseCsv(crlf).rows).toEqual(result.rows);
  });

  it('reports bad rows with line numbers and keeps the good ones', () => {
    const bad = sample + '10/01/2026,"X","X",Shopping,-1.00,Posted\n2026-10-01,"Y","Y",Shopping,abc,Posted\n';
    const r = parseCsv(bad);
    expect(r.rows).toHaveLength(7);
    expect(r.errors).toEqual([
      { line: 9, message: 'invalid date "10/01/2026"' },
      { line: 10, message: 'invalid amount "abc"' },
    ]);
  });

  it('rejects unknown formats', () => {
    expect(() => parseCsv('Posting Date,Amount\n2026-10-01,1.00\n')).toThrow(UnrecognisedFormatError);
  });
});

describe('sha256Hex', () => {
  it('hashes bytes', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer);
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
