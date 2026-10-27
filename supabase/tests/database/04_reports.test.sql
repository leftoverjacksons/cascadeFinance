-- Reporting function tests (monthly totals, balance history).

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h1', public.create_household('Home', 'Alex')::text, true);

insert into public.accounts (id, household_id, name, type) values
  ('10000000-0000-0000-0000-000000000001', current_setting('test.h1')::uuid, 'Checking', 'checking'),
  ('10000000-0000-0000-0000-000000000002', current_setting('test.h1')::uuid, 'Card', 'credit_card'),
  ('10000000-0000-0000-0000-000000000003', current_setting('test.h1')::uuid, 'Car', 'auto_loan'),
  ('10000000-0000-0000-0000-000000000004', current_setting('test.h1')::uuid, 'No balance', 'savings');

-- Checking: exported 2026-10-15 with a balance of $1,000.00.
select public.import_batch('10000000-0000-0000-0000-000000000001', repeat('a', 64),
  current_setting('test.h1') || '/10000000-0000-0000-0000-000000000001/a.csv', 'a.csv', 'usaa_bank', '2026-10-15',
  $$[
    {"posted_on":"2026-09-10","amount_cents":-5000,"raw_description":"PUBLIX 1","bank_category":"Groceries","status":"posted"},
    {"posted_on":"2026-10-05","amount_cents":-13770,"raw_description":"PUBLIX 2","bank_category":"Groceries","status":"posted"},
    {"posted_on":"2026-10-06","amount_cents":2000,"raw_description":"PUBLIX REFUND","bank_category":"Groceries","status":"posted"},
    {"posted_on":"2026-10-12","amount_cents":317628,"raw_description":"PAYROLL","bank_category":"Paycheck","status":"posted"},
    {"posted_on":"2026-10-20","amount_cents":-1000,"raw_description":"CAFE","bank_category":"Category Pending","status":"posted"},
    {"posted_on":"2026-10-21","amount_cents":-999,"raw_description":"CAFE PENDING","bank_category":"Category Pending","status":"pending"}
  ]$$::jsonb, '{}', 100000);

-- Card owes $500.00 on 2026-10-01; car loan owes $20,000.00 on 2026-09-30.
insert into public.balance_snapshots (household_id, account_id, as_of, balance_cents, source) values
  (current_setting('test.h1')::uuid, '10000000-0000-0000-0000-000000000002', '2026-10-01', 50000, 'statement'),
  (current_setting('test.h1')::uuid, '10000000-0000-0000-0000-000000000003', '2026-09-30', 2000000, 'statement');

-- ── monthly_category_totals ────────────────────────────────────────────────
select results_eq(
  $$ select inflow_cents, outflow_cents, txn_count
     from public.monthly_category_totals('2026-09-01', '2026-10-31') m
     join public.categories c on c.id = m.category_id
     where c.name = 'Groceries' and m.month = '2026-10-01' $$,
  $$ values (2000::bigint, -13770::bigint, 2) $$,
  'October groceries: refund counted as inflow, purchase as outflow');

select is(
  (select sum(txn_count)::int from public.monthly_category_totals('2026-09-01', '2026-10-31')), 5,
  'pending transactions are excluded');

select is(
  (select outflow_cents from public.monthly_category_totals('2026-09-01', '2026-10-31') where category_id is null),
  -1000::bigint, 'uncategorised rows are reported with a null category');

select is(
  (select count(*)::int from public.monthly_category_totals('2026-10-01', '2026-10-31') where month = '2026-09-01'),
  0, 'date range is respected');

-- ── balance_history ───────────────────────────────────────────────────────
create function pg_temp.bal(p_account text, p_date date) returns bigint language sql as $$
  select balance_cents from public.balance_history(array[p_date]) where account_id = p_account::uuid;
$$;
grant execute on function pg_temp.bal(text, date) to authenticated;

select is(pg_temp.bal('10000000-0000-0000-0000-000000000001', '2026-10-15'), 100000::bigint,
  'balance on the snapshot date equals the snapshot');
select is(pg_temp.bal('10000000-0000-0000-0000-000000000001', '2026-10-31'), 99000::bigint,
  'rolls forward with posted transactions only');
select is(pg_temp.bal('10000000-0000-0000-0000-000000000001', '2026-09-30'), (100000 - (-13770 + 2000 + 317628))::bigint,
  'rolls backward from a later snapshot');
select is(pg_temp.bal('10000000-0000-0000-0000-000000000002', '2026-10-31'), -50000::bigint,
  'liability balances come back negative (amount owed)');
select is(pg_temp.bal('10000000-0000-0000-0000-000000000003', '2026-08-31'), -2000000::bigint,
  'a date before the first snapshot uses the earliest snapshot');
select is(
  (select count(*)::int from public.balance_history(array['2026-10-31'::date])
   where account_id = '10000000-0000-0000-0000-000000000004'), 0,
  'accounts without any snapshot are omitted');

-- ── Isolation ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from public.monthly_category_totals('2026-01-01', '2026-12-31')), 0,
  'other household sees no totals');
select is((select count(*)::int from public.balance_history(array['2026-10-31'::date])), 0,
  'other household sees no balances');

select * from finish();
rollback;
