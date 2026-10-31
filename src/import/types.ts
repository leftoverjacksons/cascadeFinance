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
  /**
   * Converts one data record (header-keyed) to a row, returns an error
   * message, or null for a row with nothing to record (e.g. a $0.00 notice).
   */
  parseRecord(record: Record<string, string>): NormalizedRow | string | null;
}

export interface ParseResult {
  format: ImportFormat;
  rows: NormalizedRow[];
  errors: RowError[];
}
