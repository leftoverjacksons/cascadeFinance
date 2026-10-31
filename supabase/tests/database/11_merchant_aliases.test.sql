-- Merchant aliases are private to the household; a name cannot alias itself.

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h', public.create_household('Home', 'A')::text, true);

insert into public.merchant_aliases (household_id, merchant_key, same_as)
values (current_setting('test.h')::uuid, 'widget', 'acme');
select is((select same_as from public.merchant_aliases where merchant_key = 'widget'), 'acme',
  'a member can say one merchant is the same as another');
select throws_ok(
  $$ insert into public.merchant_aliases (household_id, merchant_key, same_as) values (current_setting('test.h')::uuid, 'acme', 'acme') $$,
  '23514', null, 'a merchant cannot be the same as itself');
select throws_ok(
  $$ insert into public.merchant_aliases (household_id, merchant_key, same_as) values (current_setting('test.h')::uuid, 'widget', 'other') $$,
  '23505', null, 'a name has at most one "same as"');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select public.create_household('Other', 'C');
select is((select count(*)::int from public.merchant_aliases), 0, 'another household sees none');
select throws_ok(
  $$ insert into public.merchant_aliases (household_id, merchant_key, same_as) values (current_setting('test.h')::uuid, 'x', 'y') $$,
  '42501', null, 'another household cannot add to it');

select * from finish();
rollback;
