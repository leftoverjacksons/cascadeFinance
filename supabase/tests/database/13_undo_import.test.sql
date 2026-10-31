-- Undoing an import: removes exactly the rows it added (and its balance),
-- newest first, unlinks transfers, and lets the file be imported again.

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h', public.create_household('Home', 'A')::text, true);

insert into public.accounts (id, household_id, name, type) values
  ('10000000-0000-0000-0000-00000000000a', current_setting('test.h')::uuid, 'Checking', 'checking'),
  ('10000000-0000-0000-0000-0000000000e1', current_setting('test.h')::uuid, 'Card A', 'credit_card');

create function pg_temp.imp(p_account text, p_seed text, p_rows text, p_balance bigint default null) returns uuid language sql as $$
  select (public.import_batch(p_account::uuid, encode(sha256(convert_to(p_seed, 'UTF8')), 'hex'),
    current_setting('test.h') || '/' || p_account || '/' || p_seed || '.csv', p_seed, 'discover_card', '2026-10-31',
    p_rows::jsonb, '{}'::integer[], p_balance) ->> 'import_id')::uuid;
$$;
grant execute on function pg_temp.imp(text, text, text, bigint) to authenticated;

select pg_temp.imp('10000000-0000-0000-0000-00000000000a', 'chk', $$[
  {"posted_on":"2026-10-05","amount_cents":-15000,"raw_description":"CARD E-PAYMENT","display_description":null,"bank_category":"Credit Card Payment","status":"posted"}
]$$);
-- The wrong file into Card A (it is the other card's export).
select set_config('test.wrong', pg_temp.imp('10000000-0000-0000-0000-0000000000e1', 'other-card', $$[
  {"posted_on":"2026-10-06","amount_cents":15000,"raw_description":"INTERNET PAYMENT - THANK YOU","display_description":null,"bank_category":"Payments and Credits","status":"posted"},
  {"posted_on":"2026-10-07","amount_cents":-4200,"raw_description":"EXAMPLE GROCER","display_description":null,"bank_category":"Supermarkets","status":"posted"}
]$$, 120000)::text, true);
-- A later import into the same account.
select set_config('test.later', pg_temp.imp('10000000-0000-0000-0000-0000000000e1', 'later', $$[
  {"posted_on":"2026-10-20","amount_cents":-999,"raw_description":"EXAMPLE CAFE","display_description":null,"bank_category":"Restaurants","status":"posted"}
]$$)::text, true);

select is((select count(*)::int from public.transfer_links), 1, 'the wrong file''s payment had paired with checking');
select throws_ok($$ select public.undo_import(current_setting('test.wrong')::uuid) $$, '22023',
  'undo the newer imports of this account first', 'imports are undone newest first');
select is(public.undo_import(current_setting('test.later')::uuid), 1, 'undoing the newest import removes its row');
select is(public.undo_import(current_setting('test.wrong')::uuid), 2, 'then the wrong one: both of its rows');
select is((select count(*)::int from public.transactions where account_id = '10000000-0000-0000-0000-0000000000e1'), 0,
  'the account is empty again');
select is((select count(*)::int from public.transactions where account_id = '10000000-0000-0000-0000-00000000000a'), 1,
  'other accounts are untouched');
select is((select count(*)::int from public.transfer_links), 0, 'the payment is no longer paired');
select is((select count(*)::int from public.balance_snapshots where import_id = current_setting('test.wrong')::uuid), 0,
  'its balance-at-export is gone');
select isnt(pg_temp.imp('10000000-0000-0000-0000-0000000000e1', 'other-card', $$[
  {"posted_on":"2026-10-07","amount_cents":-4200,"raw_description":"EXAMPLE GROCER","display_description":null,"bank_category":"Supermarkets","status":"posted"}
]$$), null, 'the same file can be imported again after an undo');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select public.create_household('Other', 'C');
select throws_ok($$ select public.undo_import(current_setting('test.later')::uuid) $$, '42501', null,
  'another household cannot undo it');

select * from finish();
rollback;
