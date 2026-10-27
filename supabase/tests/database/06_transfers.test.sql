-- Transfer linking and money flows (Phase 5a part 1).
--
-- Household H1 has Checking (X), Joint (J) and a credit card (C).

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h1', public.create_household('Home', 'Alex')::text, true);

insert into public.accounts (id, household_id, name, type) values
  ('10000000-0000-0000-0000-00000000000a', current_setting('test.h1')::uuid, 'Checking', 'checking'),
  ('10000000-0000-0000-0000-00000000000b', current_setting('test.h1')::uuid, 'Joint', 'checking'),
  ('10000000-0000-0000-0000-00000000000c', current_setting('test.h1')::uuid, 'Card', 'credit_card');

create function pg_temp.imp(p_account text, p_seed text, p_rows text) returns void language sql as $$
  select public.import_batch(p_account::uuid, encode(sha256(convert_to(p_seed, 'UTF8')), 'hex'),
    current_setting('test.h1') || '/' || p_account || '/' || p_seed || '.csv', p_seed, 'usaa_bank', '2026-10-31',
    p_rows::jsonb)::text::void;
$$;
create function pg_temp.txn(p_raw text) returns uuid language sql as $$
  select id from public.transactions where raw_description = p_raw;
$$;
create function pg_temp.link_of(p_raw text) returns text language sql as $$
  select coalesce((select l.status::text from public.transfer_links l
                   where l.out_txn_id = pg_temp.txn(p_raw) or l.in_txn_id = pg_temp.txn(p_raw)), 'none');
$$;
create function pg_temp.cat_of(p_raw text) returns text language sql as $$
  select coalesce(g.name || ' > ' || c.name, '(none)') || ' [' || t.category_source || ']'
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  left join public.categories g on g.id = c.parent_id
  where t.raw_description = p_raw;
$$;
grant execute on function pg_temp.imp(text, text, text) to authenticated;
grant execute on function pg_temp.txn(text) to authenticated;
grant execute on function pg_temp.link_of(text) to authenticated;
grant execute on function pg_temp.cat_of(text) to authenticated;

select pg_temp.imp('10000000-0000-0000-0000-00000000000a', 'x', $$[
  {"posted_on":"2026-10-01","amount_cents":-100000,"raw_description":"USAA FUNDS TRANSFER DB 1","status":"posted"},
  {"posted_on":"2026-10-05","amount_cents":-5000,"raw_description":"PUBLIX","bank_category":"Groceries","status":"posted"},
  {"posted_on":"2026-10-10","amount_cents":-25000,"raw_description":"USAA FUNDS TRANSFER DB 2","status":"posted"},
  {"posted_on":"2026-10-10","amount_cents":-25000,"raw_description":"USAA FUNDS TRANSFER DB 3","status":"posted"},
  {"posted_on":"2026-10-15","amount_cents":-30000,"raw_description":"CARD PAYMENT","bank_category":"Credit Card Payment","status":"posted"},
  {"posted_on":"2026-10-20","amount_cents":-4000,"raw_description":"COFFEE","status":"posted"}
]$$);

select is((select count(*)::int from public.transfer_links), 0,
  'nothing links while only one account is imported');

select pg_temp.imp('10000000-0000-0000-0000-00000000000b', 'j', $$[
  {"posted_on":"2026-10-02","amount_cents":100000,"raw_description":"USAA FUNDS TRANSFER CR 1","status":"posted"},
  {"posted_on":"2026-10-11","amount_cents":25000,"raw_description":"USAA FUNDS TRANSFER CR 2","status":"posted"},
  {"posted_on":"2026-10-12","amount_cents":25000,"raw_description":"USAA FUNDS TRANSFER CR 3","status":"posted"},
  {"posted_on":"2026-10-20","amount_cents":4000,"raw_description":"SHOP REFUND","status":"posted"},
  {"posted_on":"2026-10-30","amount_cents":100000,"raw_description":"USAA FUNDS TRANSFER CR 4","status":"posted"}
]$$);
select pg_temp.imp('10000000-0000-0000-0000-00000000000c', 'c', $$[
  {"posted_on":"2026-10-16","amount_cents":30000,"raw_description":"PAYMENT THANK YOU","status":"posted"}
]$$);

-- ── Automatic matching on import ───────────────────────────────────────────
select is(pg_temp.link_of('USAA FUNDS TRANSFER DB 1'), 'auto', 'a unique pair one day apart links automatically');
select is(pg_temp.cat_of('USAA FUNDS TRANSFER CR 1'), 'Transfers > Between Accounts [transfer]',
  'both sides become transfers, sourced from the link');
select is(
  (select count(*)::int from public.transfer_links l
   where l.out_txn_id in (pg_temp.txn('USAA FUNDS TRANSFER DB 2'), pg_temp.txn('USAA FUNDS TRANSFER DB 3'))
     and l.status = 'suggested'), 2,
  'two equal transfers in the same week link, but are flagged for review');
select is(pg_temp.cat_of('PAYMENT THANK YOU'), 'Transfers > Credit Card Payments [transfer]',
  'payments into a credit card account use the card-payment category');
select is(pg_temp.link_of('COFFEE'), 'none', 'equal and opposite amounts that do not look like transfers are not linked');
select is(pg_temp.link_of('USAA FUNDS TRANSFER CR 4'), 'none', 'no link beyond the date window');
select is(public.match_transfers(), 0, 'matching again is idempotent');

-- ── Money flows ────────────────────────────────────────────────────────────
select is(
  (select cents from public.money_flows('2026-10-01', '2026-10-31')
   where kind = 'transfer' and source = '10000000-0000-0000-0000-00000000000a'
     and target = '10000000-0000-0000-0000-00000000000b'),
  150000::bigint, 'linked transfers flow from account to account');
select is(
  (select cents from public.money_flows('2026-10-01', '2026-10-31') f
   join public.categories g on g.id::text = f.target
   where f.kind = 'spend' and g.name = 'Food & Dining'),
  5000::bigint, 'spending flows from the account to its category group');
select is(
  (select cents from public.money_flows('2026-10-01', '2026-10-31')
   where kind = 'spend' and target = 'uncategorized' and source = '10000000-0000-0000-0000-00000000000a'),
  4000::bigint, 'uncategorised money out is spending');
select is(
  (select cents from public.money_flows('2026-10-01', '2026-10-31')
   where kind = 'in_other' and target = '10000000-0000-0000-0000-00000000000b'),
  100000::bigint, 'an unlinked transfer in is shown as coming from its transfer category');
select is(
  (select count(*)::int from public.money_flows('2026-10-01', '2026-10-31') where kind = 'transfer'),
  2, 'one flow per pair of accounts (checking -> joint, checking -> card)');

-- ── Unlink, reject, relink ─────────────────────────────────────────────────
select set_config('test.l2', (select id::text from public.transfer_links where out_txn_id = pg_temp.txn('USAA FUNDS TRANSFER DB 2')), true);
select set_config('test.l2_in', (select in_txn_id::text from public.transfer_links where out_txn_id = pg_temp.txn('USAA FUNDS TRANSFER DB 2')), true);
select public.unlink_transfer(current_setting('test.l2')::uuid);
select is(pg_temp.link_of('USAA FUNDS TRANSFER DB 2'), 'none', 'unlinking removes the link');
select is(pg_temp.cat_of('USAA FUNDS TRANSFER DB 2'), 'Transfers > Between Accounts [rule]',
  'unlinked sides go back to their rule-based category');
select is(public.match_transfers(), 0, 'a rejected pair is never proposed again');

select lives_ok(
  $$ select public.link_transfer(current_setting('test.l2_in')::uuid, pg_temp.txn('USAA FUNDS TRANSFER DB 2')) $$,
  'a person can link a pair by hand, in either order');
select is(pg_temp.link_of('USAA FUNDS TRANSFER DB 2'), 'confirmed', 'manual links are confirmed');

select throws_ok(
  $$ select public.link_transfer(pg_temp.txn('PUBLIX'), pg_temp.txn('COFFEE')) $$,
  '22023', null, 'two outgoing transactions cannot be linked');

-- ── Interaction with rules and manual categories ───────────────────────────
insert into public.category_rules (household_id, priority, field, match_type, pattern, set_category_id)
select current_setting('test.h1')::uuid, 1, 'description', 'contains', 'USAA FUNDS', c.id
from public.categories c join public.categories g on g.id = c.parent_id
where g.name = 'Other' and c.name = 'Miscellaneous';
select is(pg_temp.cat_of('USAA FUNDS TRANSFER CR 1'), 'Transfers > Between Accounts [transfer]',
  'rules never override a linked transfer');

select public.set_transaction_category(array[pg_temp.txn('USAA FUNDS TRANSFER DB 1')],
  (select c.id from public.categories c join public.categories g on g.id = c.parent_id
   where g.name = 'Giving' and c.name = 'Gifts'));
select is(pg_temp.link_of('USAA FUNDS TRANSFER CR 1'), 'none',
  'choosing a spending category by hand means "not a transfer": the link is removed');
select is(pg_temp.cat_of('USAA FUNDS TRANSFER CR 1'), 'Other > Miscellaneous [rule]',
  'and the other side goes back to the rules');

select public.confirm_transfer((select id from public.transfer_links where out_txn_id = pg_temp.txn('USAA FUNDS TRANSFER DB 3')));
select is(pg_temp.link_of('USAA FUNDS TRANSFER DB 3'), 'confirmed', 'a suggested link can be confirmed');

-- ── Isolation ──────────────────────────────────────────────────────────────
select set_config('test.any_link', (select id::text from public.transfer_links limit 1), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select public.create_household('Other', 'Casey');
select is((select count(*)::int from public.transfer_links), 0, 'other household sees no transfer links');
select throws_ok(
  $$ select public.unlink_transfer(current_setting('test.any_link')::uuid) $$,
  'P0002', null, 'other household cannot unlink');

select * from finish();
rollback;
