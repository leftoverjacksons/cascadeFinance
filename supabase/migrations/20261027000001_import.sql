-- Phase 2: CSV import, transactions, balance snapshots.
--
-- Deduplication (docs/DESIGN.md §7):
--   * Posted rows are keyed by (account_id, fingerprint, occurrence), where
--     fingerprint = sha256(posted_on | amount_cents | normalised raw description)
--     and occurrence numbers identical fingerprints within one file (1, 2, ...).
--     Re-importing overlapping files is idempotent; genuine identical
--     transactions (two identical coffees on one day) are both kept.
--   * Pending rows are an ephemeral snapshot: each import replaces all pending
--     rows of the account, unless a newer export was already imported.
--
-- Clients never insert transactions directly; they call preview_import and
-- import_batch.

-- Lets child tables reference (household_id, account_id) so a row can never
-- point at an account in a different household.
alter table public.accounts
  add constraint accounts_household_id_id_key unique (household_id, id);

create type public.txn_status as enum ('posted', 'pending');

-- ---------------------------------------------------------------------------
-- Imports (one row per uploaded file)
-- ---------------------------------------------------------------------------

create table public.imports (
  id                      uuid primary key default gen_random_uuid(),
  household_id            uuid not null,
  account_id              uuid not null,
  uploaded_by             uuid references auth.users (id) on delete set null,
  storage_path            text not null,
  original_filename       text not null check (length(original_filename) <= 255),
  format                  text not null check (length(format) <= 50),
  file_sha256             text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  exported_on             date not null,
  balance_at_export_cents bigint,
  rows_total              integer not null default 0,
  rows_inserted           integer not null default 0,
  rows_duplicate          integer not null default 0,
  rows_skipped            integer not null default 0,
  rows_pending            integer not null default 0,
  pending_replaced        boolean not null default false,
  date_min                date,
  date_max                date,
  created_at              timestamptz not null default now(),
  foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete cascade,
  unique (account_id, file_sha256)
);

create index imports_account_idx on public.imports (account_id, exported_on desc);

alter table public.imports enable row level security;

create policy "members read household imports"
  on public.imports for select to authenticated
  using (private.is_member(household_id));

revoke all on public.imports from anon, authenticated;
grant select on public.imports to authenticated;

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null,
  account_id          uuid not null,
  import_id           uuid references public.imports (id) on delete set null,
  posted_on           date not null,
  amount_cents        bigint not null,             -- negative = money leaving the account
  raw_description     text not null,               -- bank's original string, never edited
  display_description text not null,               -- editable
  bank_category       text,                        -- kept verbatim, not authoritative
  status              public.txn_status not null,
  fingerprint         text,
  occurrence          smallint,
  notes               text check (notes is null or length(notes) <= 1000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete cascade,
  check ((status = 'posted') = (fingerprint is not null and occurrence is not null))
);

create unique index transactions_dedup_key
  on public.transactions (account_id, fingerprint, occurrence)
  where status = 'posted';

create index transactions_household_date_idx
  on public.transactions (household_id, posted_on desc, id);
create index transactions_account_date_idx
  on public.transactions (account_id, posted_on desc);

create trigger transactions_touch_updated_at
  before update on public.transactions
  for each row execute function private.touch_updated_at();

alter table public.transactions enable row level security;

create policy "members read household transactions"
  on public.transactions for select to authenticated
  using (private.is_member(household_id));

create policy "members annotate household transactions"
  on public.transactions for update to authenticated
  using (private.is_member(household_id))
  with check (private.is_member(household_id));

revoke all on public.transactions from anon, authenticated;
grant select on public.transactions to authenticated;
grant update (display_description, notes) on public.transactions to authenticated;

-- ---------------------------------------------------------------------------
-- Balance snapshots (from exports, statements or manual entry)
-- ---------------------------------------------------------------------------

create table public.balance_snapshots (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null,
  account_id    uuid not null,
  as_of         date not null,
  balance_cents bigint not null,
  source        text not null check (source in ('export', 'statement', 'manual')),
  import_id     uuid references public.imports (id) on delete cascade,
  created_at    timestamptz not null default now(),
  foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete cascade
);

create index balance_snapshots_account_idx on public.balance_snapshots (account_id, as_of desc);

alter table public.balance_snapshots enable row level security;

create policy "members read household balances"
  on public.balance_snapshots for select to authenticated
  using (private.is_member(household_id));

create policy "members record manual balances"
  on public.balance_snapshots for insert to authenticated
  with check (private.is_member(household_id) and source in ('statement', 'manual') and import_id is null);

revoke all on public.balance_snapshots from anon, authenticated;
grant select, insert on public.balance_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- Staging: turns the client's normalised rows into keyed rows
-- ---------------------------------------------------------------------------

create function private.normalize_description(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(btrim(p), '\s+', ' ', 'g'));
$$;

-- p_rows: JSON array of
--   {posted_on: 'YYYY-MM-DD', amount_cents: int, raw_description: text,
--    display_description: text?, bank_category: text?, status: 'posted'|'pending'}
-- ordinal is the 1-based position in the array (= position in the file).
create function private.stage_rows(p_rows jsonb)
returns table (
  ordinal             integer,
  posted_on           date,
  amount_cents        bigint,
  raw_description     text,
  display_description text,
  bank_category       text,
  status              public.txn_status,
  fingerprint         text,
  occurrence          smallint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_bad integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'rows must be a JSON array' using errcode = '22023';
  end if;

  select r.ord into v_bad
  from jsonb_array_elements(p_rows) with ordinality as r(v, ord)
  where (r.v->>'posted_on') is null
     or (r.v->>'posted_on') !~ '^\d{4}-\d{2}-\d{2}$'
     or (r.v->>'amount_cents') is null
     or (r.v->>'amount_cents') !~ '^-?\d+$'
     or coalesce(btrim(r.v->>'raw_description'), '') = ''
     or (r.v->>'status') not in ('posted', 'pending')
  order by r.ord
  limit 1;

  if v_bad is not null then
    raise exception 'row % is malformed', v_bad using errcode = '22023';
  end if;

  return query
  with parsed as (
    select
      r.ord::integer as ordinal,
      (r.v->>'posted_on')::date as posted_on,
      (r.v->>'amount_cents')::bigint as amount_cents,
      btrim(r.v->>'raw_description') as raw_description,
      coalesce(nullif(btrim(r.v->>'display_description'), ''), btrim(r.v->>'raw_description'))
        as display_description,
      nullif(btrim(r.v->>'bank_category'), '') as bank_category,
      (r.v->>'status')::public.txn_status as status
    from jsonb_array_elements(p_rows) with ordinality as r(v, ord)
  ),
  keyed as (
    select p.*,
      case when p.status = 'posted' then
        encode(sha256(convert_to(
          p.posted_on::text || '|' || p.amount_cents::text || '|'
            || private.normalize_description(p.raw_description),
          'UTF8')), 'hex')
      end as fingerprint
    from parsed p
  )
  select k.ordinal, k.posted_on, k.amount_cents, k.raw_description, k.display_description,
         k.bank_category, k.status, k.fingerprint,
         case when k.status = 'posted' then
           (row_number() over (partition by k.status, k.fingerprint order by k.ordinal))::smallint
         end as occurrence
  from keyed k
  order by k.ordinal;
end;
$$;

revoke all on function private.normalize_description(text) from public;
revoke all on function private.stage_rows(jsonb) from public;
grant execute on function private.normalize_description(text) to authenticated;
grant execute on function private.stage_rows(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- preview_import: classifies each row without writing anything
--   outcome: 'new' | 'duplicate' | 'pending'
--   suspect: for 'new' rows, an existing posted transaction in the account with
--            the same amount within ±3 days that this file does not account for
--            (possible re-worded duplicate). The user decides whether to skip.
-- ---------------------------------------------------------------------------

create function public.preview_import(p_account_id uuid, p_rows jsonb)
returns table (ordinal integer, outcome text, suspect jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  -- RLS on accounts: invisible unless the caller is a member of its household.
  if not exists (select 1 from public.accounts a where a.id = p_account_id) then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  return query
  with staged as (
    select * from private.stage_rows(p_rows)
  ),
  existing as (
    select t.id, t.posted_on, t.amount_cents, t.raw_description, t.fingerprint, t.occurrence
    from public.transactions t
    where t.account_id = p_account_id and t.status = 'posted'
      and t.posted_on between (select min(s.posted_on) - 3 from staged s)
                          and (select max(s.posted_on) + 3 from staged s)
  ),
  unmatched_existing as (
    select e.* from existing e
    where not exists (
      select 1 from staged s
      where s.status = 'posted' and s.fingerprint = e.fingerprint and s.occurrence = e.occurrence)
  )
  select
    s.ordinal,
    case
      when s.status = 'pending' then 'pending'
      when exists (select 1 from existing e
                   where e.fingerprint = s.fingerprint and e.occurrence = s.occurrence) then 'duplicate'
      else 'new'
    end,
    case when s.status = 'posted' then (
      select jsonb_build_object('id', u.id, 'posted_on', u.posted_on,
                                'raw_description', u.raw_description)
      from unmatched_existing u
      where u.amount_cents = s.amount_cents
        and abs(u.posted_on - s.posted_on) <= 3
        and not exists (select 1 from existing e
                        where e.fingerprint = s.fingerprint and e.occurrence = s.occurrence)
      order by abs(u.posted_on - s.posted_on), u.id
      limit 1)
    end
  from staged s
  order by s.ordinal;
end;
$$;

revoke all on function public.preview_import(uuid, jsonb) from public, anon;
grant execute on function public.preview_import(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- import_batch: records the file and inserts its rows, atomically
-- ---------------------------------------------------------------------------

create function public.import_batch(
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
    where i.account_id = p_account_id and i.id <> v_import and i.exported_on > p_exported_on);

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

revoke all on function public.import_batch(uuid, text, text, text, text, date, jsonb, integer[], bigint)
  from public, anon;
grant execute on function public.import_batch(uuid, text, text, text, text, date, jsonb, integer[], bigint)
  to authenticated;
