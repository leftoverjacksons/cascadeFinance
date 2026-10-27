import type { Json } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import type { NormalizedRow } from './types';

export interface PreviewRow {
  ordinal: number;
  outcome: 'new' | 'duplicate' | 'pending';
  suspect: { id: string; posted_on: string; raw_description: string } | null;
}

export interface ImportSummary {
  import_id: string;
  rows_total: number;
  rows_inserted: number;
  rows_duplicate: number;
  rows_skipped: number;
  rows_pending: number;
  pending_replaced: boolean;
}

/** Archive location: imports/{household}/{account}/{exported_on}_{sha256 prefix}.csv */
export function archivePath(householdId: string, accountId: string, exportedOn: string, sha256: string) {
  return `${householdId}/${accountId}/${exportedOn}_${sha256.slice(0, 16)}.csv`;
}

function isAlreadyExists(error: unknown): boolean {
  const e = error as { statusCode?: string; status?: number; code?: string } | null;
  return e?.statusCode === '409' || e?.status === 409 || e?.code === 'ResourceAlreadyExists';
}

export async function previewImport(accountId: string, rows: NormalizedRow[]): Promise<PreviewRow[]> {
  const { data, error } = await supabase.rpc('preview_import', {
    p_account_id: accountId,
    p_rows: rows as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return data as PreviewRow[];
}

export interface ImportRequest {
  householdId: string;
  accountId: string;
  file: File;
  bytes: ArrayBuffer;
  sha256: string;
  formatId: string;
  exportedOn: string;
  balanceCents: number | null;
  rows: NormalizedRow[];
  /** 1-based ordinals of rows the user chose not to import. */
  skip: number[];
}

/**
 * 1. Archive the original file, byte-for-byte (append-only bucket).
 * 2. Record the import and insert its rows in one database transaction.
 * 3. Write a provenance sidecar next to the file.
 */
export async function runImport(req: ImportRequest): Promise<ImportSummary> {
  const path = archivePath(req.householdId, req.accountId, req.exportedOn, req.sha256);
  const bucket = supabase.storage.from('imports');

  const upload = await bucket.upload(path, req.bytes, { contentType: 'text/csv', upsert: false });
  // Same path = same content hash, so an existing object is the same file.
  if (upload.error && !isAlreadyExists(upload.error)) {
    throw new Error(`Could not archive the file: ${upload.error.message}`);
  }

  const { data, error } = await supabase.rpc('import_batch', {
    p_account_id: req.accountId,
    p_file_sha256: req.sha256,
    p_storage_path: path,
    p_original_filename: req.file.name.slice(0, 255),
    p_format: req.formatId,
    p_exported_on: req.exportedOn,
    p_rows: req.rows as unknown as Json,
    p_skip: req.skip,
    ...(req.balanceCents === null ? {} : { p_balance_cents: req.balanceCents }),
  });
  if (error) throw new Error(error.message);
  const summary = data as unknown as ImportSummary;

  const meta = {
    import_id: summary.import_id,
    account_id: req.accountId,
    original_filename: req.file.name,
    format: req.formatId,
    sha256: req.sha256,
    exported_on: req.exportedOn,
    balance_at_export_cents: req.balanceCents,
    imported_at: new Date().toISOString(),
    summary,
  };
  // Best effort: the database row is the authoritative record.
  await bucket.upload(`${path}.meta.json`, JSON.stringify(meta, null, 2), {
    contentType: 'application/json',
    upsert: false,
  });

  return summary;
}
