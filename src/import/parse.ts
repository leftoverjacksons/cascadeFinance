import Papa from 'papaparse';
import { usaaBank } from './formats/usaa';
import type { ImportFormat, NormalizedRow, ParseResult, RowError } from './types';

export const FORMATS: ImportFormat[] = [usaaBank];

export class UnrecognisedFormatError extends Error {
  constructor(public readonly header: string[]) {
    super(`Unrecognised file format. Header: ${header.join(', ')}`);
  }
}

/** Parses CSV text, auto-detecting the format from its header row. */
export function parseCsv(text: string, formats: ImportFormat[] = FORMATS): ParseResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  const [header = [], ...records] = parsed.data;
  const format = formats.find((f) => f.matches(header));
  if (!format) throw new UnrecognisedFormatError(header);

  const rows: NormalizedRow[] = [];
  const errors: RowError[] = [];
  records.forEach((cells, i) => {
    const line = i + 2;
    if (cells.length !== header.length) {
      errors.push({ line, message: `expected ${header.length} columns, found ${cells.length}` });
      return;
    }
    const record = Object.fromEntries(header.map((h, j) => [h.trim(), cells[j]]));
    const result = format.parseRecord(record);
    if (typeof result === 'string') errors.push({ line, message: result });
    else rows.push(result);
  });
  return { format, rows, errors };
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
