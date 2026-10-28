-- The household's real money flow (docs/DESIGN.md §9a): A sends mortgage and
-- bill money into joint checking; B moves it on to savings; the mortgage is
-- paid from savings. Two variants, depending on who owns the savings account.

begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h', public.create_household('Home', 'A')::text, true);
select public.add_household_member('b@test.local', 'B');

insert into public.accounts (id, household_id, name, type, owner_user_id) values
  ('10000000-0000-0000-0000-0000000000a1', current_setting('test.h')::uuid, 'A checking', 'checking', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-0000000000f1', current_setting('test.h')::uuid, 'Joint checking', 'checking', null),
  ('10000000-0000-0000-0000-0000000000f2', current_setting('test.h')::uuid, 'Joint savings', 'savings', null),
  ('10000000-0000-0000-0000-0000000000b2', current_setting('test.h')::uuid, 'B savings', 'savings', '00000000-0000-0000-0000-00000000000b');

create function pg_temp.imp(p_account text, p_seed text, p_rows text) returns void language sql as $$
  select public.import_batch(p_account::uuid, encode(sha256(convert_to(p_seed, 'UTF8')), 'hex'),
    current_setting('test.h') || '/' || p_account || '/' || p_seed || '.csv', p_seed, 'usaa_bank', '2026-10-31',
    p_rows::jsonb)::text::void;
$$;
create function pg_temp.b_owes_a(p_from date) returns bigint language sql as $$
  select coalesce(sum(case when debtor = '00000000-0000-0000-0000-00000000000b' then cents else -cents end), 0)::bigint
  from public.shared_ledger() where entry_date >= p_from;
$$;
grant execute on function pg_temp.imp(text, text, text) to authenticated;
grant execute on function pg_temp.b_owes_a(date) to authenticated;

-- September: savings is joint. A funds the whole $2,000 mortgage.
select pg_temp.imp('10000000-0000-0000-0000-0000000000a1', 'a', $$[
  {"posted_on":"2026-09-01","amount_cents":-200000,"raw_description":"USAA FUNDS TRANSFER DB SEP","status":"posted"},
  {"posted_on":"2026-10-01","amount_cents":-100000,"raw_description":"USAA FUNDS TRANSFER DB OCT","status":"posted"}
]$$);
select pg_temp.imp('10000000-0000-0000-0000-0000000000f1', 'j', $$[
  {"posted_on":"2026-09-02","amount_cents":200000,"raw_description":"USAA FUNDS TRANSFER CR SEP","status":"posted"},
  {"posted_on":"2026-09-03","amount_cents":-200000,"raw_description":"USAA FUNDS TRANSFER DB TO SAVINGS","status":"posted"},
  {"posted_on":"2026-10-02","amount_cents":100000,"raw_description":"USAA FUNDS TRANSFER CR OCT","status":"posted"},
  {"posted_on":"2026-10-03","amount_cents":-100000,"raw_description":"USAA FUNDS TRANSFER DB TO B SAVINGS","status":"posted"}
]$$);
select pg_temp.imp('10000000-0000-0000-0000-0000000000f2', 's', $$[
  {"posted_on":"2026-09-04","amount_cents":200000,"raw_description":"USAA FUNDS TRANSFER CR FROM JOINT","status":"posted"},
  {"posted_on":"2026-09-15","amount_cents":-200000,"raw_description":"MORTGAGE CO SEP","bank_category":"Home","status":"posted"}
]$$);
-- October: B's own savings. A sends his half ($1,000); B pays the $2,000 mortgage.
select pg_temp.imp('10000000-0000-0000-0000-0000000000b2', 'b', $$[
  {"posted_on":"2026-10-04","amount_cents":100000,"raw_description":"USAA FUNDS TRANSFER CR FROM JOINT 2","status":"posted"},
  {"posted_on":"2026-10-15","amount_cents":-200000,"raw_description":"MORTGAGE CO OCT","bank_category":"Home","status":"posted"}
]$$);

select is((select count(*)::int from public.member_transfers() where from_user is null and to_user is null), 0,
  'moves between joint accounts are not member transfers');
select is(pg_temp.b_owes_a('2026-09-01') - pg_temp.b_owes_a('2026-10-01'), 100000::bigint,
  'joint savings: A funded the whole mortgage, so B owes A half of it');
select is(pg_temp.b_owes_a('2026-10-01'), 0::bigint,
  'B''s own savings: A sent his half and B paid the mortgage, so they are square');

select * from finish();
rollback;
