-- Undo an import (docs/DESIGN.md: Import & deduplication). Removes the
-- transactions the import added and its balance-at-export, re-runs transfer
-- matching, and marks the import undone. The import record and the original
-- file are kept (audit); an undone file may be imported again.
--
-- Only an account's most recent remaining import can be undone: a later
-- import may have skipped rows as already present because this one added
-- them, so imports are undone newest first.

alter table public.imports
  add column undone_at timestamptz,
  add column undone_by uuid references auth.users (id) on delete set null;

-- "Newest" is by created_at: take the actual clock time (now() is fixed for
-- a whole database transaction, so two imports in one would tie).
alter table public.imports alter column created_at set default clock_timestamp();

-- One import of a given file per account, among imports not undone.
alter table public.imports drop constraint imports_account_id_file_sha256_key;
create unique index imports_account_file_live_idx on public.imports (account_id, file_sha256) where undone_at is null;

create function public.undo_import(p_import uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import public.imports;
  v_removed integer;
begin
  select * into v_import from public.imports where id = p_import;
  if v_import.id is null or not private.is_member(v_import.household_id) then
    raise exception 'import not found' using errcode = '42501';
  end if;
  if v_import.undone_at is not null then
    raise exception 'this import has already been undone' using errcode = '22023';
  end if;
  if exists (select 1 from public.imports i
             where i.account_id = v_import.account_id and i.undone_at is null
               and i.created_at > v_import.created_at) then
    raise exception 'undo the newer imports of this account first' using errcode = '22023';
  end if;

  delete from public.transactions where import_id = p_import;
  get diagnostics v_removed = row_count;
  delete from public.balance_snapshots where import_id = p_import;
  update public.imports set undone_at = now(), undone_by = auth.uid() where id = p_import;
  perform private.match_transfers(v_import.household_id);
  return v_removed;
end;
$$;

revoke all on function public.undo_import(uuid) from public, anon;
grant execute on function public.undo_import(uuid) to authenticated;

-- Same as before, except that an undone import no longer counts as a newer
-- export when deciding whether to replace pending rows.
create or replace function public.import_batch(
  p_account_id        uuid,
  p_file_sha256       text,
  p_storage_path      text,
  p_original_filename text,
  p_format            text,
  p_exported_on       date,
  p_rows              jsonb,
  p_skip              integer[] default '{}',
  p_balance_cents     bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household   uuid;
  v_import      uuid;
  v_total       integer;
  v_posted      integer;
  v_skipped     integer;
  v_pending     integer;
  v_inserted    integer;
  v_replace     boolean;
  v_min         date;
  v_max         date;
begin
  select a.household_id into v_household
  from public.accounts a
  where a.id = p_account_id and private.is_member(a.household_id);

  if v_household is null then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  if split_part(p_storage_path, '/', 1) <> v_household::text
     or split_part(p_storage_path, '/', 2) <> p_account_id::text then
    raise exception 'storage path does not match account' using errcode = '22023';
  end if;

  -- Dropped first so the function can run more than once per transaction.
  drop table if exists pg_temp.staged;
  create temporary table staged on commit drop as
    select * from private.stage_rows(p_rows);

  select count(*),
         count(*) filter (where status = 'posted' and ordinal <> all (p_skip)),
         count(*) filter (where status = 'posted' and ordinal = any (p_skip)),
         count(*) filter (where status = 'pending'),
         min(posted_on), max(posted_on)
    into v_total, v_posted, v_skipped, v_pending, v_min, v_max
  from staged;

  begin
    insert into public.imports (
      household_id, account_id, uploaded_by, storage_path, original_filename, format,
      file_sha256, exported_on, balance_at_export_cents, date_min, date_max)
    values (
      v_household, p_account_id, auth.uid(), p_storage_path, p_original_filename, p_format,
      p_file_sha256, p_exported_on, p_balance_cents, v_min, v_max)
    returning id into v_import;
  exception when unique_violation then
    raise exception 'this file has already been imported into this account' using errcode = '23505';
  end;

  -- Pending rows: replace the account's snapshot, unless a newer export exists.
  v_replace := not exists (
    select 1 from public.imports i
    where i.account_id = p_account_id and i.id <> v_import and i.exported_on > p_exported_on
      and i.undone_at is null);

  if v_replace then
    delete from public.transactions t
    where t.account_id = p_account_id and t.status = 'pending';

    insert into public.transactions (
      household_id, account_id, import_id, posted_on, amount_cents,
      raw_description, display_description, bank_category, status)
    select v_household, p_account_id, v_import, s.posted_on, s.amount_cents,
           s.raw_description, s.display_description, s.bank_category, 'pending'
    from staged s
    where s.status = 'pending';
  end if;

  insert into public.transactions (
    household_id, account_id, import_id, posted_on, amount_cents,
    raw_description, display_description, bank_category, status, fingerprint, occurrence)
  select v_household, p_account_id, v_import, s.posted_on, s.amount_cents,
         s.raw_description, s.display_description, s.bank_category, 'posted',
         s.fingerprint, s.occurrence
  from staged s
  where s.status = 'posted' and s.ordinal <> all (p_skip)
  on conflict (account_id, fingerprint, occurrence) where status = 'posted' do nothing;

  get diagnostics v_inserted = row_count;

  if p_balance_cents is not null then
    insert into public.balance_snapshots (household_id, account_id, as_of, balance_cents, source, import_id)
    values (v_household, p_account_id, p_exported_on, p_balance_cents, 'export', v_import);
  end if;

  update public.imports set
    rows_total = v_total,
    rows_inserted = v_inserted,
    rows_duplicate = v_posted - v_inserted,
    rows_skipped = v_skipped,
    rows_pending = case when v_replace then v_pending else 0 end,
    pending_replaced = v_replace
  where id = v_import;

  return jsonb_build_object(
    'import_id', v_import,
    'rows_total', v_total,
    'rows_inserted', v_inserted,
    'rows_duplicate', v_posted - v_inserted,
    'rows_skipped', v_skipped,
    'rows_pending', case when v_replace then v_pending else 0 end,
    'pending_replaced', v_replace);
end;
$$;
