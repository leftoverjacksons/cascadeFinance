/** A bank row normalised to the shape the import RPCs expect. */
export interface NormalizedRow {
  posted_on: string; // YYYY-MM-DD
  amount_cents: number; // negative = money leaving the account
  raw_description: string;
  display_description: string | null;
  bank_category: string | null;
  status: 'posted' | 'pending';
}

export interface RowError {
  /** 1-based line number in the file, header = line 1. */
  line: number;
  message: string;
}

export interface ImportFormat {
  /** Stored on the import record, e.g. 'usaa_bank'. */
  id: string;
  label: string;
  /** True if this format recognises the file's header row. */
  matches(header: string[]): boolean;
  /** Converts one data record (header-keyed) to a row, or returns an error message. */
  parseRecord(record: Record<string, string>): NormalizedRow | string;
}

export interface ParseResult {
  format: ImportFormat;
  rows: NormalizedRow[];
  errors: RowError[];
}
