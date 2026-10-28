-- Shared expenses, paybacks and the member balance (Phase 5a part 2).
--
-- A and B share a household (50/50). TA = A's checking, CB = B's checking,
-- J = joint checking.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h1', public.create_household('Home', 'A')::text, true);
select public.add_household_member('b@test.local', 'B');

insert into public.accounts (id, household_id, name, type, owner_user_id) values
  ('10000000-0000-0000-0000-0000000000a1', current_setting('test.h1')::uuid, 'A checking', 'checking', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-0000000000b1', current_setting('test.h1')::uuid, 'B checking', 'checking', '00000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-0000000000f1', current_setting('test.h1')::uuid, 'Joint', 'checking', null);

create function pg_temp.imp(p_account text, p_seed text, p_rows text) returns void language sql as $$
  select public.import_batch(p_account::uuid, encode(sha256(convert_to(p_seed, 'UTF8')), 'hex'),
    current_setting('test.h1') || '/' || p_account || '/' || p_seed || '.csv', p_seed, 'usaa_bank', '2026-10-31',
    p_rows::jsonb)::text::void;
$$;
-- What B owes A (negative: A owes B).
create function pg_temp.b_owes_a() returns bigint language sql as $$
  select coalesce(sum(case when debtor = '00000000-0000-0000-0000-00000000000b' then cents else -cents end), 0)::bigint
  from public.shared_ledger();
$$;
create function pg_temp.txn(p_raw text) returns uuid language sql as $$
  select id from public.transactions where raw_description = p_raw;
$$;
grant execute on function pg_temp.imp(text, text, text) to authenticated;
grant execute on function pg_temp.b_owes_a() to authenticated;
grant execute on function pg_temp.txn(text) to authenticated;

select pg_temp.imp('10000000-0000-0000-0000-0000000000a1', 'a', $$[
  {"posted_on":"2026-10-01","amount_cents":-10000,"raw_description":"KROGER 1","bank_category":"Groceries","status":"posted"},
  {"posted_on":"2026-10-02","amount_cents":-4000,"raw_description":"BARBER","bank_category":"Hair","status":"posted"},
  {"posted_on":"2026-10-03","amount_cents":-2000,"raw_description":"BOOKSTORE","bank_category":"Books","status":"posted"},
  {"posted_on":"2026-10-04","amount_cents":1000,"raw_description":"KROGER REFUND","bank_category":"Groceries","status":"posted"},
  {"posted_on":"2026-10-05","amount_cents":-60000,"raw_description":"USAA FUNDS TRANSFER DB 1","status":"posted"},
  {"posted_on":"2026-10-10","amount_cents":-30000,"raw_description":"USAA FUNDS TRANSFER DB 2","status":"posted"},
  {"posted_on":"2026-10-20","amount_cents":-20000,"raw_description":"USAA FUNDS TRANSFER DB 3","status":"posted"},
  {"posted_on":"2026-10-25","amount_cents":-5000,"raw_description":"ZELLE TO B","status":"posted"}
]$$);
select pg_temp.imp('10000000-0000-0000-0000-0000000000b1', 'b', $$[
  {"posted_on":"2026-10-06","amount_cents":60000,"raw_description":"USAA FUNDS TRANSFER CR 1","status":"posted"},
  {"posted_on":"2026-10-07","amount_cents":-8000,"raw_description":"PUBLIX","bank_category":"Groceries","status":"posted"},
  {"posted_on":"2026-10-14","amount_cents":30000,"raw_description":"USAA FUNDS TRANSFER CR 2","status":"posted"},
  {"posted_on":"2026-10-25","amount_cents":5000,"raw_description":"ZELLE FROM A","status":"posted"}
]$$);
select pg_temp.imp('10000000-0000-0000-0000-0000000000f1', 'j', $$[
  {"posted_on":"2026-10-11","amount_cents":30000,"raw_description":"USAA FUNDS TRANSFER CR J1","status":"posted"},
  {"posted_on":"2026-10-13","amount_cents":-30000,"raw_description":"USAA FUNDS TRANSFER DB J2","status":"posted"},
  {"posted_on":"2026-10-21","amount_cents":20000,"raw_description":"USAA FUNDS TRANSFER CR J3","status":"posted"},
  {"posted_on":"2026-10-22","amount_cents":-15000,"raw_description":"ELECTRIC CO","bank_category":"Utilities","status":"posted"}
]$$);

-- ── Defaults ───────────────────────────────────────────────────────────────
select ok((select is_shared from public.categories where name = 'Groceries'), 'groceries are shared by default');
select ok(not (select is_shared from public.categories where name = 'Personal Care'), 'personal care is not');

-- ── Member transfers ───────────────────────────────────────────────────────
select is((select count(*)::int from public.member_transfers() where kind = 'payback'), 2,
  'paybacks: transfers between the two personal accounts (bank transfer and Zelle)');
select is((select count(*)::int from public.member_transfers() where kind = 'contribution'), 2,
  'contributions: A put money into the joint account twice');
select is(
  (select to_user from public.member_transfers() where kind = 'withdrawal'),
  '00000000-0000-0000-0000-00000000000b'::uuid,
  'withdrawal: B took money out of the joint account');
select is(
  (select sum(amount_cents)::bigint from public.member_transfers() where kind = 'contribution'), 50000::bigint,
  'contribution amounts');

-- Same result whatever order the accounts were imported in (B before joint here).
select is(public.match_transfers(), 0, 're-matching changes nothing once all accounts are in');
select is(
  (select count(*)::int from public.transfer_links where status = 'confirmed'), 0,
  'no links were confirmed by hand in this scenario');

-- ── Ledger ─────────────────────────────────────────────────────────────────
update public.transactions set shared_override = true where raw_description = 'BOOKSTORE';

select is(
  (select cents from public.shared_ledger() where description = 'Kroger 1' or ref_id = pg_temp.txn('KROGER 1')),
  5000::bigint, 'a shared expense paid by A: B owes half');
select is((select count(*)::int from public.shared_ledger() where ref_id = pg_temp.txn('BARBER')), 0,
  'personal expenses are not in the ledger');
select is((select cents from public.shared_ledger() where ref_id = pg_temp.txn('BOOKSTORE')), 1000::bigint,
  'a transaction can be marked shared even if its category is not');
select is((select cents from public.shared_ledger() where ref_id = pg_temp.txn('KROGER REFUND')), -500::bigint,
  'refunds on shared expenses reduce what is owed');
select is((select count(*)::int from public.shared_ledger() where ref_id = pg_temp.txn('ELECTRIC CO')), 0,
  'spending from the joint account creates no debt');

select is(
  (select sum(cents)::bigint from public.shared_ledger()
   where entry_kind in ('contribution', 'withdrawal') and ref_id in (
     pg_temp.txn('USAA FUNDS TRANSFER DB 2'), pg_temp.txn('USAA FUNDS TRANSFER DB J2'))),
  30000::bigint, 'A -> joint -> B nets to a full payback from A to B');
select is(
  (select cents from public.shared_ledger() where ref_id = pg_temp.txn('USAA FUNDS TRANSFER DB 3')), 10000::bigint,
  'money A put into the joint pot (and the pot spent) counts as A paying toward shared costs: B owes half');

-- Shared spending: 5000 + 1000 - 500 (A's) - 4000 (B's Publix)
-- Paybacks A -> B: 60000 + 5000; via joint: 30000; A's contribution: 20000 / 2
select is(pg_temp.b_owes_a(), 106500::bigint, 'running balance: B owes A');

-- ── Not a payback; manual settlement; start date ───────────────────────────
insert into public.settlement_overrides (out_txn_id, household_id, is_settlement)
values (pg_temp.txn('USAA FUNDS TRANSFER DB 1'), current_setting('test.h1')::uuid, false);
select is(pg_temp.b_owes_a(), 46500::bigint, 'a transfer marked "not a payback" no longer counts');

insert into public.manual_settlements (household_id, from_user_id, to_user_id, amount_cents, settled_on, note)
values (current_setting('test.h1')::uuid, '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a',
        46500, '2026-10-31', 'Cash');
select is(pg_temp.b_owes_a(), 0::bigint, 'B paying A by hand settles the balance');

update public.households set shared_since = '2026-10-08';
select is(
  (select count(*)::int from public.shared_ledger() where entry_date < '2026-10-08'), 0,
  'the ledger starts at the household''s start date');

-- ── Isolation ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select public.create_household('Other', 'C');
select is((select count(*)::int from public.shared_ledger()), 0, 'other household sees no ledger');
select throws_ok(
  $$ insert into public.manual_settlements (household_id, from_user_id, to_user_id, amount_cents, settled_on)
     values (current_setting('test.h1')::uuid, '00000000-0000-0000-0000-00000000000a',
             '00000000-0000-0000-0000-00000000000b', 100, '2026-10-31') $$,
  '42501', null, 'other household cannot record settlements');

select * from finish();
rollback;
