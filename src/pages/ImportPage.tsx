import {
  IonBadge,
  IonButton,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonToast,
} from '@ionic/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { todayLocal, formatDay } from '../domain/dates';
import { formatCents, parseAmountToCents } from '../domain/money';
import { useRequiredHousehold } from '../household/HouseholdProvider';
import { useAccounts } from '../household/useAccounts';
import { previewImport, runImport, type ImportSummary, type PreviewRow } from '../import/importFile';
import { FORMATS, parseCsv, sha256Hex, UnrecognisedFormatError } from '../import/parse';
import type { ParseResult } from '../import/types';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';

type ImportRecord = Database['public']['Tables']['imports']['Row'];

const LAST_ACCOUNT_KEY = 'cascade.import.lastAccount';

function readLastAccount(): string {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY) ?? '';
  } catch {
    return '';
  }
}

interface LoadedFile {
  file: File;
  bytes: ArrayBuffer;
  sha256: string;
  parsed: ParseResult;
}

export default function ImportPage() {
  const { household } = useRequiredHousehold();
  const { accounts } = useAccounts();
  const [toast] = useIonToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [accountId, setAccountId] = useState(readLastAccount);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [previewState, setPreview] = useState<{ key: string; rows: PreviewRow[] } | null>(null);
  // A preview is only valid for the exact file and account it was computed for.
  const previewKey = loaded && accountId ? `${loaded.sha256}:${accountId}` : null;
  const preview = previewState && previewState.key === previewKey ? previewState.rows : null;
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [exportedOn, setExportedOn] = useState(todayLocal());
  const [balance, setBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [alreadyImported, setAlreadyImported] = useState<ImportRecord | null>(null);

  const active = accounts.filter((a) => !a.is_archived);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Unknown account';
  const balanceCents = balance.trim() === '' ? null : parseAmountToCents(balance);
  const balanceValid = balance.trim() === '' || balanceCents !== null;

  const loadHistory = useCallback(async () => {
    const { data } = await supabase.from('imports').select('*').order('created_at', { ascending: false }).limit(20);
    setHistory(data ?? []);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Re-run the preview whenever the file or target account changes.
  useEffect(() => {
    setPreview(null);
    setSkip(new Set());
    setAlreadyImported(null);
    if (!loaded || !accountId || loaded.parsed.rows.length === 0) return;
    let cancelled = false;
    setBusy(true);
    supabase
      .from('imports')
      .select('*')
      .eq('account_id', accountId)
      .eq('file_sha256', loaded.sha256)
      .maybeSingle()
      .then(({ data }) => !cancelled && setAlreadyImported(data));
    const key = `${loaded.sha256}:${accountId}`;
    previewImport(accountId, loaded.parsed.rows)
      .then((rows) => !cancelled && setPreview({ key, rows }))
      .catch((e: Error) => toast({ message: e.message, duration: 5000, color: 'danger' }))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [loaded, accountId, toast]);

  async function onFile(file: File | undefined) {
    setResult(null);
    setLoaded(null);
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      const text = new TextDecoder('utf-8').decode(bytes);
      const parsed = parseCsv(text);
      setLoaded({ file, bytes, sha256: await sha256Hex(bytes), parsed });
    } catch (e) {
      const message =
        e instanceof UnrecognisedFormatError
          ? `This file format is not supported yet. Supported: ${FORMATS.map((f) => f.label).join(', ')}.`
          : `Could not read the file: ${(e as Error).message}`;
      void toast({ message, duration: 6000, color: 'danger' });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function chooseAccount(id: string) {
    setAccountId(id);
    try {
      localStorage.setItem(LAST_ACCOUNT_KEY, id);
    } catch {
      /* storage unavailable: not remembered */
    }
  }

  const counts = useMemo(() => {
    const c = { new: 0, duplicate: 0, pending: 0, suspect: 0 };
    for (const r of preview ?? []) {
      c[r.outcome]++;
      if (r.suspect) c.suspect++;
    }
    return c;
  }, [preview]);

  async function doImport() {
    if (!loaded || !preview) return;
    setBusy(true);
    try {
      const summary = await runImport({
        householdId: household.id,
        accountId,
        file: loaded.file,
        bytes: loaded.bytes,
        sha256: loaded.sha256,
        formatId: loaded.parsed.format.id,
        exportedOn,
        balanceCents,
        rows: loaded.parsed.rows,
        skip: [...skip],
      });
      setResult(summary);
      setLoaded(null);
      setBalance('');
      await loadHistory();
    } catch (e) {
      void toast({ message: (e as Error).message, duration: 6000, color: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const rows = loaded?.parsed.rows ?? [];
  const newRows = (preview ?? []).filter((p) => p.outcome === 'new');
  const suspects = newRows.filter((p) => p.suspect);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Import</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="import-layout">
          <div>
            {active.length === 0 ? (
              <div className="ion-padding">
                <IonText color="medium">Add an account first (Accounts tab).</IonText>
              </div>
            ) : (
              <IonList inset>
                <IonItem>
                  <IonSelect
                    label="Account"
                    labelPlacement="stacked"
                    placeholder="Choose the account this file is from"
                    value={accountId || undefined}
                    onIonChange={(e) => chooseAccount(e.detail.value as string)}
                  >
                    {active.map((a) => (
                      <IonSelectOption key={a.id} value={a.id}>
                        {a.name}
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
                <IonItem>
                  <IonLabel>
                    <h3>CSV file</h3>
                    <p>{loaded ? loaded.file.name : `A .csv export: ${FORMATS.map((f) => f.label).join(', ')}`}</p>
                  </IonLabel>
                  <IonButton slot="end" onClick={() => fileInput.current?.click()} disabled={busy}>
                    Choose file
                  </IonButton>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    data-testid="csv-input"
                    onChange={(e) => void onFile(e.target.files?.[0])}
                  />
                </IonItem>
                <IonItem>
                  <IonInput
                    label="Exported on"
                    labelPlacement="stacked"
                    type="date"
                    value={exportedOn}
                    onIonInput={(e) => setExportedOn(e.detail.value ?? todayLocal())}
                  />
                </IonItem>
                <IonItem>
                  <IonInput
                    label={
                      accounts.find((a) => a.id === accountId)?.is_liability
                        ? 'Amount owed when exported (optional)'
                        : 'Current balance when exported (optional)'
                    }
                    labelPlacement="stacked"
                    inputmode="decimal"
                    placeholder="e.g. 2,431.17"
                    value={balance}
                    onIonInput={(e) => setBalance(e.detail.value ?? '')}
                    className={balanceValid ? '' : 'ion-invalid ion-touched'}
                    errorText="Not a valid amount"
                  />
                </IonItem>
              </IonList>
            )}

            {loaded && (
              <IonList inset data-testid="preview">
                <IonListHeader>
                  {loaded.parsed.format.label} · {rows.length} rows
                </IonListHeader>
                {!accountId && (
                  <IonItem>
                    <IonText color="warning">Choose the account above to see what is new.</IonText>
                  </IonItem>
                )}
                {busy && !preview && (
                  <IonItem>
                    <IonSpinner name="dots" />
                  </IonItem>
                )}
                {preview && (
                  <>
                    <IonItem>
                      <IonLabel>New</IonLabel>
                      <IonBadge color="success">{counts.new - skip.size}</IonBadge>
                    </IonItem>
                    <IonItem>
                      <IonLabel>Already imported</IonLabel>
                      <IonBadge color="medium">{counts.duplicate}</IonBadge>
                    </IonItem>
                    <IonItem>
                      <IonLabel>Pending (replaces current pending)</IonLabel>
                      <IonBadge color="warning">{counts.pending}</IonBadge>
                    </IonItem>
                  </>
                )}
                {loaded.parsed.errors.length > 0 && (
                  <IonItem>
                    <IonLabel color="danger" className="ion-text-wrap">
                      <h3>{loaded.parsed.errors.length} unreadable rows will be ignored</h3>
                      {loaded.parsed.errors.slice(0, 5).map((e) => (
                        <p key={e.line}>
                          Line {e.line}: {e.message}
                        </p>
                      ))}
                    </IonLabel>
                  </IonItem>
                )}
              </IonList>
            )}

            {suspects.length > 0 && (
              <IonList inset>
                <IonListHeader>Possible duplicates ({suspects.length})</IonListHeader>
                <IonItem lines="none">
                  <IonText color="medium">
                    <p className="hint">
                      Same amount within 3 days of a transaction already recorded, but described differently. Tick any
                      that are the same transaction to skip them.
                    </p>
                  </IonText>
                </IonItem>
                {suspects.map((p) => {
                  const row = rows[p.ordinal - 1];
                  return (
                    <IonItem key={p.ordinal}>
                      <IonCheckbox
                        slot="start"
                        checked={skip.has(p.ordinal)}
                        onIonChange={(e) => {
                          const next = new Set(skip);
                          if (e.detail.checked) next.add(p.ordinal);
                          else next.delete(p.ordinal);
                          setSkip(next);
                        }}
                        aria-label="Skip this row"
                      />
                      <IonLabel className="ion-text-wrap">
                        <h3>
                          {formatDay(row.posted_on)} · {formatCents(row.amount_cents)}
                        </h3>
                        <p>New: {row.raw_description}</p>
                        <p>
                          Existing ({formatDay(p.suspect!.posted_on)}): {p.suspect!.raw_description}
                        </p>
                      </IonLabel>
                    </IonItem>
                  );
                })}
              </IonList>
            )}

            {alreadyImported && (
              <IonList inset>
                <IonItem>
                  <IonText color="warning" className="ion-text-wrap">
                    This exact file was already imported into {accountName(accountId)} on{' '}
                    {formatDay(alreadyImported.created_at.slice(0, 10))}.
                  </IonText>
                </IonItem>
              </IonList>
            )}

            {preview && !alreadyImported && (
              <div className="ion-padding narrow-block">
                <IonButton
                  expand="block"
                  onClick={() => void doImport()}
                  disabled={busy || !balanceValid || !exportedOn}
                >
                  {counts.new - skip.size > 0 || counts.pending > 0
                    ? `Import ${counts.new - skip.size} new transactions`
                    : 'Record import (nothing new)'}
                </IonButton>
              </div>
            )}

            {result && (
              <IonList inset data-testid="import-result">
                <IonListHeader>Import complete</IonListHeader>
                <IonItem>
                  <IonLabel className="ion-text-wrap">
                    {result.rows_inserted} added · {result.rows_duplicate} already present · {result.rows_skipped}{' '}
                    skipped ·{' '}
                    {result.pending_replaced
                      ? `${result.rows_pending} pending`
                      : 'pending rows ignored (a newer export was already imported)'}
                  </IonLabel>
                </IonItem>
              </IonList>
            )}
          </div>
          <div>
            {newRows.length > 0 && (
              <IonList inset>
                <IonListHeader>New transactions</IonListHeader>
                {newRows.slice(0, 50).map((p) => {
                  const row = rows[p.ordinal - 1];
                  return (
                    <IonItem key={p.ordinal} className={skip.has(p.ordinal) ? 'skipped' : ''}>
                      <IonLabel>
                        <h3>{row.display_description ?? row.raw_description}</h3>
                        <p>{formatDay(row.posted_on)}</p>
                      </IonLabel>
                      <IonNote slot="end" className={row.amount_cents > 0 ? 'credit' : ''}>
                        {formatCents(row.amount_cents)}
                      </IonNote>
                    </IonItem>
                  );
                })}
                {newRows.length > 50 && (
                  <IonItem>
                    <IonNote>…and {newRows.length - 50} more</IonNote>
                  </IonItem>
                )}
              </IonList>
            )}

            {history.length > 0 && (
              <IonList inset>
                <IonListHeader>Recent imports</IonListHeader>
                {history.map((h) => (
                  <IonItem key={h.id}>
                    <IonLabel className="ion-text-wrap">
                      <h3>{accountName(h.account_id)}</h3>
                      <p>
                        {h.original_filename} · exported {formatDay(h.exported_on)}
                        {h.date_min && h.date_max && ` · covers ${h.date_min} to ${h.date_max}`}
                      </p>
                      <p>
                        {h.rows_inserted} added, {h.rows_duplicate} duplicates, {h.rows_skipped} skipped,{' '}
                        {h.rows_pending} pending
                        {h.balance_at_export_cents !== null && ` · balance ${formatCents(h.balance_at_export_cents)}`}
                      </p>
                    </IonLabel>
                  </IonItem>
                ))}
              </IonList>
            )}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
