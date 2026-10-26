-- Access-control tests for the Phase 1 foundation schema.
-- Run with: npm run db:test   (requires `npm run db:start`)
--
-- Actors:
--   A  owner of household "Home"
--   B  member of "Home" (added by A)
--   C  owner of a different household "Other"
--   D  authenticated user with no household
--   anon  unauthenticated

begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.local', 'authenticated', 'authenticated');

set local role authenticated;

-- ── A: household creation and membership ────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok(
  $$ select set_config('test.hh1', public.create_household('Home', 'Alex')::text, true) $$,
  'A can create a household');

select throws_ok(
  $$ select public.create_household('Second', 'Alex') $$,
  '23505', null, 'A cannot create a second household');

select lives_ok(
  $$ select public.add_household_member('B@Test.Local', 'Blair') $$,
  'owner can add an existing user by email (case-insensitive)');

select throws_ok(
  $$ select public.add_household_member('nobody@test.local', 'Nobody') $$,
  'P0002', null, 'adding an unknown email fails');

select throws_ok(
  $$ insert into public.household_members (household_id, user_id, display_name)
     values (current_setting('test.hh1')::uuid, '00000000-0000-0000-0000-00000000000d', 'Sneaky') $$,
  '42501', null, 'direct insert into household_members is not permitted');

select lives_ok(
  $$ insert into public.accounts (household_id, name, institution, type, owner_user_id)
     values (current_setting('test.hh1')::uuid, 'Alex Checking', 'USAA', 'checking',
             '00000000-0000-0000-0000-00000000000a') $$,
  'member can create an account in own household');

select is(
  (select is_liability from public.accounts where name = 'Alex Checking'), false,
  'checking account is not a liability');

select lives_ok(
  $$ insert into public.accounts (household_id, name, type)
     values (current_setting('test.hh1')::uuid, 'Joint Card', 'credit_card') $$,
  'member can create a joint account (no owner)');

select is(
  (select is_liability from public.accounts where name = 'Joint Card'), true,
  'credit card is a liability');

-- ── B: non-owner member ────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select throws_ok(
  $$ select public.add_household_member('d@test.local', 'Dana') $$,
  '42501', null, 'non-owner member cannot add members');

select is((select count(*)::int from public.accounts), 2,
  'member B sees all household accounts');

select is((select count(*)::int from public.household_members), 2,
  'member B sees both household members');

select throws_ok(
  $$ update public.household_members set role = 'owner'
     where user_id = '00000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'member cannot change roles');

select lives_ok(
  $$ update public.household_members set split_weight = 2
     where user_id = '00000000-0000-0000-0000-00000000000b' $$,
  'member can change split weight');

-- ── C: separate household ──────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select lives_ok(
  $$ select set_config('test.hh2', public.create_household('Other', 'Casey')::text, true) $$,
  'C can create a separate household');

select lives_ok(
  $$ insert into public.accounts (household_id, name, type)
     values (current_setting('test.hh2')::uuid, 'Casey Checking', 'checking') $$,
  'C can create an account in own household');

select is((select count(*)::int from public.accounts), 1,
  'C sees only own household accounts');

-- ── A: cross-household isolation ───────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select throws_ok(
  $$ insert into public.accounts (household_id, name, type)
     values (current_setting('test.hh2')::uuid, 'Planted', 'checking') $$,
  '42501', null, 'A cannot create an account in another household');

update public.accounts set name = 'Hacked' where name = 'Casey Checking';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select name from public.accounts where household_id = current_setting('test.hh2')::uuid),
  'Casey Checking', 'A cannot modify another household''s account');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select throws_ok(
  $$ insert into public.accounts (household_id, name, type, owner_user_id)
     values (current_setting('test.hh1')::uuid, 'Bad owner', 'checking',
             '00000000-0000-0000-0000-00000000000c') $$,
  '23503', null, 'account owner must be a member of the same household');

-- ── Storage: import archive is scoped by household folder ─────────────────
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('imports', '%s/acct/a.csv') $$,
         current_setting('test.hh1')),
  'A can upload into own household folder');

select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('imports', '%s/acct/x.csv') $$,
         current_setting('test.hh2')),
  '42501', null, 'A cannot upload into another household folder');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'imports'), 0,
  'C cannot see A''s import files');

-- ── D: authenticated, no household ─────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);

select is((select count(*)::int from public.households), 0, 'user without household sees no households');
select is((select count(*)::int from public.accounts), 0, 'user without household sees no accounts');

-- ── anon ───────────────────────────────────────────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select * from public.accounts $$,
  '42501', null, 'anonymous users have no access to accounts');

select * from finish();
rollback;
