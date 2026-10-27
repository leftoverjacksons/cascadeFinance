-- Per-person preferences are private, even within a household.

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select public.create_household('Home', 'Alex');
select public.add_household_member('b@test.local', 'Blair');

select lives_ok(
  $$ insert into public.user_preferences (dashboard_layout) values ('{"version":1,"items":[]}') $$,
  'a user can save their own layout (user_id defaults to the caller)');

select lives_ok(
  $$ insert into public.user_preferences (dashboard_layout) values ('{"version":1}')
     on conflict (user_id) do update set dashboard_layout = excluded.dashboard_layout $$,
  'upsert updates the existing row');

select throws_ok(
  $$ insert into public.user_preferences (user_id, dashboard_layout)
     values ('00000000-0000-0000-0000-00000000000b', '{}') $$,
  '42501', null, 'cannot write another user''s preferences');

select throws_ok(
  $$ update public.user_preferences set dashboard_layout = '[1,2]' $$,
  '23514', null, 'layout must be a JSON object');

-- Household partner B cannot see A's row.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.user_preferences), 0, 'partner cannot read another member''s preferences');
update public.user_preferences set dashboard_layout = '{"hijacked":true}';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select dashboard_layout->>'version' from public.user_preferences), '1', 'partner cannot modify another member''s preferences');

select * from finish();
rollback;
