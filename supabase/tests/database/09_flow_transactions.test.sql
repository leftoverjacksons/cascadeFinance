-- Money-flow drill-down: the transactions behind each flow add up to it.

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h', public.create_household('Home', 'A')::text, true);

insert into public.accounts (id, household_id, name, type) values
  ('10000000-0000-0000-0000-00000000000a', current_setting('test.h')::uuid, 'Checking', 'checking'),
  ('10000000-0000-0000-0000-00000000000b', current_setting('test.h')::uuid, 'Joint', 'checking');

create function pg_temp.imp(p_account text, p_seed text, p_rows text) returns void language sql as $$
  select public.import_batch(p_account::uuid, encode(sha256(convert_to(p_seed, 'UTF8')), 'hex'),
    current_setting('test.h') || '/' || p_account || '/' || p_seed || '.csv', p_seed, 'usaa_bank', '2026-10-31',
    p_rows::jsonb)::text::void;
$$;
grant execute on function pg_temp.imp(text, text, text) to authenticated;

select pg_temp.imp('10000000-0000-0000-0000-00000000000a', 'x', $$[
  {"posted_on":"2026-10-01","amount_cents":300000,"raw_description":"ACME PAYROLL","bank_category":"Paycheck","status":"posted"},
  {"posted_on":"2026-10-02","amount_cents":-6000,"raw_description":"KROGER 1","bank_category":"Groceries","status":"posted"},
  {"posted_on":"2026-10-03","amount_cents":-4000,"raw_description":"KROGER 2","bank_category":"Groceries","status":"posted"},
  {"posted_on":"2026-10-04","amount_cents":1000,"raw_description":"KROGER REFUND","bank_category":"Groceries","status":"posted"},
  {"posted_on":"2026-10-05","amount_cents":-50000,"raw_description":"USAA FUNDS TRANSFER DB","status":"posted"},
  {"posted_on":"2026-10-06","amount_cents":-2000,"raw_description":"MYSTERY","status":"posted"},
  {"posted_on":"2026-10-07","amount_cents":-9000,"raw_description":"PENDING SHOP","bank_category":"Shopping","status":"pending"}
]$$);
select pg_temp.imp('10000000-0000-0000-0000-00000000000b', 'j', $$[
  {"posted_on":"2026-10-06","amount_cents":50000,"raw_description":"USAA FUNDS TRANSFER CR","status":"posted"}
]$$);

-- What each flow's transactions add up to, signed as money_flows sums them.
create function pg_temp.flow_total(p_kind text, p_source text, p_target text) returns bigint language sql as $$
  select sum(case when p_kind in ('income', 'in_other') then amount_cents else -amount_cents end)::bigint
  from public.money_flow_transactions('2026-10-01', '2026-10-31', array[p_kind], array[p_source], array[p_target]);
$$;
grant execute on function pg_temp.flow_total(text, text, text) to authenticated;

select is(
  (select count(*)::int from public.money_flows('2026-10-01', '2026-10-31') f
   where pg_temp.flow_total(f.kind, f.source, f.target) is distinct from f.cents),
  0, 'every flow equals the sum of the transactions behind it');
select is(
  (select count(*)::int from public.money_flows('2026-10-01', '2026-10-31')),
  4, 'income, groceries, uncategorised spending, checking -> joint');
select is(
  (select array_agg(raw_description order by raw_description)
   from public.money_flow_transactions('2026-10-01', '2026-10-31',
     array['spend'], array['10000000-0000-0000-0000-00000000000a'],
     array[(select coalesce(parent_id, id)::text from public.categories where name = 'Groceries')])),
  array['KROGER 1', 'KROGER 2', 'KROGER REFUND'], 'a spending flow lists its purchases and refunds');
select is(
  (select array_agg(raw_description)
   from public.money_flow_transactions('2026-10-01', '2026-10-31',
     array['transfer'], array['10000000-0000-0000-0000-00000000000a'], array['10000000-0000-0000-0000-00000000000b'])),
  array['USAA FUNDS TRANSFER DB'], 'a linked transfer is listed once, by its outgoing side');
select is(
  (select count(*)::int
   from public.money_flow_transactions('2026-10-01', '2026-10-31',
     array['spend', 'income'], array['10000000-0000-0000-0000-00000000000a', (select id::text from public.categories where name = 'Paycheck')],
     array['uncategorized', '10000000-0000-0000-0000-00000000000a'])),
  2, 'several flows at once (a merged node): uncategorised spending and the paycheck');

-- ── Saved positions ────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.user_preferences (sankey_positions) values ('[1, 2]') $$,
  '23514', null, 'saved positions must be an object');

-- ── Isolation ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select public.create_household('Other', 'C');
select is(
  (select count(*)::int from public.money_flow_transactions('2026-10-01', '2026-10-31',
     array['transfer'], array['10000000-0000-0000-0000-00000000000a'], array['10000000-0000-0000-0000-00000000000b'])),
  0, 'another household sees none of these transactions');

select * from finish();
rollback;
