-- Recurring-charge dismissals are private to the household.

begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h', public.create_household('Home', 'A')::text, true);

insert into public.recurring_dismissals (household_id, merchant_key)
values (current_setting('test.h')::uuid, 'target');
select is((select count(*)::int from public.recurring_dismissals), 1, 'a member can hide a merchant');
select throws_ok(
  $$ insert into public.recurring_dismissals (household_id, merchant_key) values (current_setting('test.h')::uuid, '') $$,
  '23514', null, 'the merchant key must not be empty');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select public.create_household('Other', 'C');
select is((select count(*)::int from public.recurring_dismissals), 0, 'another household sees none');
select throws_ok(
  $$ insert into public.recurring_dismissals (household_id, merchant_key) values (current_setting('test.h')::uuid, 'netflix') $$,
  '42501', null, 'another household cannot add to it');

select * from finish();
rollback;
