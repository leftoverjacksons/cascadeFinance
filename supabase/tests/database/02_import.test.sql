-- Import / deduplication tests (docs/DESIGN.md §7 invariants).
--
-- Actors: A (owner of household H1, accounts X and Y), C (owner of H2).
-- Account X receives file A then file B; account Y receives B then A, to show
-- the final set of posted rows does not depend on import order.

begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h1', public.create_household('Home', 'Alex')::text, true);

insert into public.accounts (id, household_id, name, type) values
  ('10000000-0000-0000-0000-000000000001', current_setting('test.h1')::uuid, 'X', 'checking'),
  ('10000000-0000-0000-0000-000000000002', current_setting('test.h1')::uuid, 'Y', 'checking');

-- File A: two identical coffees on one day, a grocery run, one pending row.
select set_config('test.file_a', $$[
  {"posted_on":"2026-10-01","amount_cents":-500,"raw_description":"COFFEE SHOP   ATLANTA GA","display_description":"Coffee Shop","bank_category":"Coffee Shops","status":"posted"},
  {"posted_on":"2026-10-01","amount_cents":-500,"raw_description":"COFFEE SHOP ATLANTA GA","display_description":"Coffee Shop","bank_category":"Coffee Shops","status":"posted"},
  {"posted_on":"2026-10-02","amount_cents":-13770,"raw_description":"PUBLIX SUPER MAR 3695","display_description":"Publix","bank_category":"Groceries","status":"posted"},
  {"posted_on":"2026-10-03","amount_cents":-3875,"raw_description":"PUBLIX #503 102526","bank_category":"Category Pending","status":"pending"}
]$$, true);

-- File B (later export, overlaps A): a third identical coffee, the pending
-- Publix now posted under a different description, and a paycheck.
select set_config('test.file_b', $$[
  {"posted_on":"2026-10-01","amount_cents":-500,"raw_description":"coffee shop atlanta ga","status":"posted"},
  {"posted_on":"2026-10-01","amount_cents":-500,"raw_description":"COFFEE SHOP ATLANTA GA","status":"posted"},
  {"posted_on":"2026-10-01","amount_cents":-500,"raw_description":"COFFEE SHOP ATLANTA GA","status":"posted"},
  {"posted_on":"2026-10-02","amount_cents":-13770,"raw_description":"PUBLIX SUPER MAR 3695","status":"posted"},
  {"posted_on":"2026-10-03","amount_cents":-3875,"raw_description":"PUBLIX #503 ATLANTA GA","status":"posted"},
  {"posted_on":"2026-10-04","amount_cents":317628,"raw_description":"EMPLOYER PAYROLL","status":"posted"}
]$$, true);

create function pg_temp.do_import(p_account uuid, p_sha_seed text, p_exported date, p_rows text,
                                  p_skip integer[] default '{}', p_balance bigint default null)
returns jsonb language sql as $$
  select public.import_batch(
    p_account,
    encode(sha256(convert_to(p_sha_seed, 'UTF8')), 'hex'),
    current_setting('test.h1') || '/' || p_account || '/' || p_sha_seed || '.csv',
    p_sha_seed || '.csv', 'usaa_bank', p_exported, p_rows::jsonb, p_skip, p_balance);
$$;
grant execute on function pg_temp.do_import(uuid, text, date, text, integer[], bigint) to authenticated;

-- ── Preview ────────────────────────────────────────────────────────────────
select results_eq(
  $$ select outcome from public.preview_import('10000000-0000-0000-0000-000000000001',
       current_setting('test.file_a')::jsonb) order by ordinal $$,
  $$ values ('new'), ('new'), ('new'), ('pending') $$,
  'preview of first file: all posted rows new, pending flagged');

select is(
  (select count(*)::int from public.transactions), 0,
  'preview writes nothing');

-- ── First import ───────────────────────────────────────────────────────────
select is(
  pg_temp.do_import('10000000-0000-0000-0000-000000000001', 'file-a', '2026-10-03',
                    current_setting('test.file_a'), '{}', 123456)
    - 'import_id',
  '{"rows_total":4,"rows_inserted":3,"rows_duplicate":0,"rows_skipped":0,"rows_pending":1,"pending_replaced":true}'::jsonb,
  'first import inserts 3 posted + 1 pending');

select is(
  (select count(*)::int from public.transactions
   where account_id = '10000000-0000-0000-0000-000000000001' and amount_cents = -500), 2,
  'two identical same-day coffees are both kept');

select is(
  (select balance_cents from public.balance_snapshots
   where account_id = '10000000-0000-0000-0000-000000000001'), 123456::bigint,
  'balance at export is recorded as a snapshot');

select is(
  (select display_description from public.transactions where amount_cents = -13770), 'Publix',
  'display description taken from the bank''s cleaned name');

select is(
  (select display_description from public.transactions where status = 'pending'), 'PUBLIX #503 102526',
  'display description falls back to raw description');

-- ── Re-import ──────────────────────────────────────────────────────────────
select throws_ok(
  $$ select pg_temp.do_import('10000000-0000-0000-0000-000000000001', 'file-a', '2026-10-03',
                              current_setting('test.file_a')) $$,
  '23505', null, 'the identical file cannot be imported twice');

select is(
  (pg_temp.do_import('10000000-0000-0000-0000-000000000001', 'file-a-redownload', '2026-10-03',
                     current_setting('test.file_a'))->>'rows_inserted')::int, 0,
  'same content under a different file hash inserts nothing');

select is(
  (select count(*)::int from public.transactions
   where account_id = '10000000-0000-0000-0000-000000000001'), 4,
  'still 3 posted + 1 pending after re-import');

-- Manual edit that a later import must not overwrite.
update public.transactions set display_description = 'Groceries run', notes = 'weekly shop'
where amount_cents = -13770;

-- ── Overlapping later file ─────────────────────────────────────────────────
select results_eq(
  $$ select outcome from public.preview_import('10000000-0000-0000-0000-000000000001',
       current_setting('test.file_b')::jsonb) order by ordinal $$,
  $$ values ('duplicate'), ('duplicate'), ('new'), ('duplicate'), ('new'), ('new') $$,
  'preview of overlapping file: only the third coffee, posted Publix and paycheck are new');

select is(
  pg_temp.do_import('10000000-0000-0000-0000-000000000001', 'file-b', '2026-10-05',
                    current_setting('test.file_b'))
    - 'import_id',
  '{"rows_total":6,"rows_inserted":3,"rows_duplicate":3,"rows_skipped":0,"rows_pending":0,"pending_replaced":true}'::jsonb,
  'overlapping import inserts only the 3 new rows');

select is(
  (select count(*)::int from public.transactions
   where account_id = '10000000-0000-0000-0000-000000000001' and status = 'pending'), 0,
  'pending row replaced by the newer export''s (empty) pending set');

select is(
  (select count(*)::int from public.transactions
   where account_id = '10000000-0000-0000-0000-000000000001' and amount_cents = -500), 3,
  'third identical coffee added as a new occurrence');

select is(
  (select display_description || ' / ' || notes from public.transactions where amount_cents = -13770),
  'Groceries run / weekly shop',
  'manual edits survive re-import');

-- ── Order independence ─────────────────────────────────────────────────────
select is(
  (pg_temp.do_import('10000000-0000-0000-0000-000000000002', 'file-b', '2026-10-05',
                     current_setting('test.file_b'))->>'rows_inserted')::int, 6,
  'account Y: file B first inserts all 6');

select is(
  pg_temp.do_import('10000000-0000-0000-0000-000000000002', 'file-a', '2026-10-03',
                    current_setting('test.file_a'))->>'pending_replaced', 'false',
  'account Y: older file A does not replace pending rows from the newer export');

select is(
  (select count(*)::int from public.transactions
   where account_id = '10000000-0000-0000-0000-000000000002' and status = 'pending'), 0,
  'account Y: stale pending row from the older file was not added');

select results_eq(
  $$ select posted_on, amount_cents, private.normalize_description(raw_description) from public.transactions
     where account_id = '10000000-0000-0000-0000-000000000002' and status = 'posted'
     order by 1, 2, 3 $$,
  $$ select posted_on, amount_cents, private.normalize_description(raw_description) from public.transactions
     where account_id = '10000000-0000-0000-0000-000000000001' and status = 'posted'
     order by 1, 2, 3 $$,
  'final posted rows are identical regardless of import order');

-- ── Suspected duplicates and skipping ──────────────────────────────────────
select set_config('test.file_c', $$[
  {"posted_on":"2026-10-04","amount_cents":-13770,"raw_description":"PUBLIX 3695 ATL (REPROCESSED)","status":"posted"},
  {"posted_on":"2026-10-06","amount_cents":-2474,"raw_description":"CHICK-FIL-A #03797","status":"posted"}
]$$, true);

select is(
  (select suspect->>'raw_description' from public.preview_import(
     '10000000-0000-0000-0000-000000000001', current_setting('test.file_c')::jsonb)
   where ordinal = 1),
  'PUBLIX SUPER MAR 3695',
  'new row with same amount within 3 days of an existing row is flagged as suspect');

select is(
  (select suspect from public.preview_import(
     '10000000-0000-0000-0000-000000000001', current_setting('test.file_c')::jsonb)
   where ordinal = 2),
  null::jsonb,
  'unrelated new row is not flagged');

select is(
  pg_temp.do_import('10000000-0000-0000-0000-000000000001', 'file-c', '2026-10-06',
                    current_setting('test.file_c'), '{1}')
    - 'import_id' - 'pending_replaced',
  '{"rows_total":2,"rows_inserted":1,"rows_duplicate":0,"rows_skipped":1,"rows_pending":0}'::jsonb,
  'skipped row is not imported');

-- ── Validation ─────────────────────────────────────────────────────────────
select throws_ok(
  $$ select public.preview_import('10000000-0000-0000-0000-000000000001',
       '[{"posted_on":"10/01/2026","amount_cents":-1,"raw_description":"X","status":"posted"}]') $$,
  '22023', 'row 1 is malformed', 'malformed date rejected');

select throws_ok(
  $$ select public.import_batch('10000000-0000-0000-0000-000000000001', repeat('a', 64),
       'someone-else/path.csv', 'f.csv', 'usaa_bank', '2026-10-06', '[]', '{}', null) $$,
  '22023', 'storage path does not match account', 'storage path must be under household/account');

-- ── Direct writes are blocked ──────────────────────────────────────────────
select throws_ok(
  $$ update public.transactions set amount_cents = 0 $$,
  '42501', null, 'amounts cannot be edited');

select throws_ok(
  $$ insert into public.transactions (household_id, account_id, posted_on, amount_cents,
       raw_description, display_description, status)
     values (current_setting('test.h1')::uuid, '10000000-0000-0000-0000-000000000001',
             '2026-10-01', 1, 'x', 'x', 'pending') $$,
  '42501', null, 'transactions cannot be inserted directly');

select throws_ok(
  $$ insert into public.balance_snapshots (household_id, account_id, as_of, balance_cents, source)
     values (current_setting('test.h1')::uuid, '10000000-0000-0000-0000-000000000001',
             '2026-10-01', 1, 'export') $$,
  '42501', null, 'export-sourced snapshots can only come from an import');

-- ── Other household ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select public.create_household('Other', 'Casey');

select is((select count(*)::int from public.transactions), 0, 'other household sees no transactions');
select is((select count(*)::int from public.imports), 0, 'other household sees no imports');

select throws_ok(
  $$ select * from public.preview_import('10000000-0000-0000-0000-000000000001', '[]') $$,
  'P0002', null, 'other household cannot preview into the account');

select throws_ok(
  $$ select public.import_batch('10000000-0000-0000-0000-000000000001', repeat('b', 64),
       'x/y/z.csv', 'f.csv', 'usaa_bank', '2026-10-06', '[]', '{}', null) $$,
  'P0002', null, 'other household cannot import into the account');

select * from finish();
rollback;
