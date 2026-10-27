-- Categories and rules tests (docs/DESIGN.md §8).

begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h1', public.create_household('Home', 'Alex')::text, true);

insert into public.accounts (id, household_id, name, type) values
  ('10000000-0000-0000-0000-000000000001', current_setting('test.h1')::uuid, 'Checking', 'checking'),
  ('10000000-0000-0000-0000-000000000002', current_setting('test.h1')::uuid, 'Card', 'credit_card');

create function pg_temp.cat(p_group text, p_name text) returns uuid language sql as $$
  select c.id from public.categories c join public.categories g on g.id = c.parent_id
  where g.name = p_group and c.name = p_name;
$$;
create function pg_temp.cat_of(p_raw text) returns text language sql as $$
  select coalesce(g.name || ' > ' || c.name, '(none)') || ' [' || t.category_source || ']'
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  left join public.categories g on g.id = c.parent_id
  where t.raw_description = p_raw;
$$;
grant execute on function pg_temp.cat(text, text) to authenticated;
grant execute on function pg_temp.cat_of(text) to authenticated;

-- ── Seeding ────────────────────────────────────────────────────────────────
select is((select count(*)::int from public.categories where parent_id is null), 15,
  'new household gets 15 starter groups');
select ok((select count(*) from public.category_rules where field = 'bank_category') > 40,
  'new household gets bank-category mapping rules');
select is((select kind::text from public.categories c where c.id = pg_temp.cat('Transfers', 'Loan Payments')),
  'transfer', 'children inherit the group''s kind');

-- ── Categorise on import ───────────────────────────────────────────────────
select public.import_batch('10000000-0000-0000-0000-000000000001', repeat('a', 64),
  current_setting('test.h1') || '/10000000-0000-0000-0000-000000000001/a.csv', 'a.csv', 'usaa_bank', '2026-10-10',
  $$[
    {"posted_on":"2026-10-01","amount_cents":-13770,"raw_description":"PUBLIX SUPER MAR 3695","bank_category":"Groceries","status":"posted"},
    {"posted_on":"2026-10-02","amount_cents":-650,"raw_description":"SQ *CORNER CAFE","bank_category":"Coffee Shops","status":"posted"},
    {"posted_on":"2026-10-03","amount_cents":-1499,"raw_description":"MONARCH MONEY APP","bank_category":"Category Pending","status":"posted"},
    {"posted_on":"2026-10-04","amount_cents":-100000,"raw_description":"USAA FUNDS TRANSFER DB","bank_category":"Category Pending","status":"posted"},
    {"posted_on":"2026-10-05","amount_cents":-1857,"raw_description":"RAINWALK PETS","bank_category":"Pets","status":"posted"},
    {"posted_on":"2026-10-09","amount_cents":-3875,"raw_description":"PUBLIX #503 100926","bank_category":"Category Pending","status":"pending"}
  ]$$::jsonb);

select is(pg_temp.cat_of('PUBLIX SUPER MAR 3695'), 'Food & Dining > Groceries [rule]',
  'imported row categorised from the bank category');
select is(pg_temp.cat_of('MONARCH MONEY APP'), '(none) [none]',
  'no matching rule leaves the row uncategorised');
select is(pg_temp.cat_of('USAA FUNDS TRANSFER DB'), 'Transfers > Between Accounts [rule]',
  'seeded description rule catches internal transfers');

-- ── Rules ──────────────────────────────────────────────────────────────────
select is(
  (select matching from public.preview_category_rule('description', 'contains', 'publix')),
  2, 'preview counts matching rows (posted and pending) without changing anything');
select is(pg_temp.cat_of('PUBLIX #503 100926'), '(none) [none]',
  'preview did not categorise anything');

insert into public.category_rules (household_id, field, match_type, pattern, set_category_id)
values (current_setting('test.h1')::uuid, 'description', 'contains', 'publix',
        pg_temp.cat('Food & Dining', 'Groceries'));

select is(pg_temp.cat_of('PUBLIX #503 100926'), 'Food & Dining > Groceries [rule]',
  'creating a rule categorises existing rows, including pending ones');

insert into public.category_rules (household_id, field, match_type, pattern, set_category_id)
values (current_setting('test.h1')::uuid, 'description', 'starts_with', 'sq *corner',
        pg_temp.cat('Food & Dining', 'Restaurants'));
select is(pg_temp.cat_of('SQ *CORNER CAFE'), 'Food & Dining > Restaurants [rule]',
  'description rule (priority 100) beats bank-category rule (priority 1000)');

insert into public.category_rules (household_id, priority, field, match_type, pattern, set_category_id, amount_min_cents)
values (current_setting('test.h1')::uuid, 50, 'description', 'regex', '^monarch\s+money',
        pg_temp.cat('Entertainment', 'Subscriptions'), 2000);
select is(pg_temp.cat_of('MONARCH MONEY APP'), '(none) [none]',
  'amount range excludes a $14.99 row from a "≥ $20" rule');
update public.category_rules set amount_min_cents = 1000 where pattern = '^monarch\s+money';
select is(pg_temp.cat_of('MONARCH MONEY APP'), 'Entertainment > Subscriptions [rule]',
  'editing a rule re-categorises (regex, case-insensitive)');

insert into public.category_rules (household_id, priority, field, match_type, pattern, set_category_id, account_id)
values (current_setting('test.h1')::uuid, 10, 'description', 'contains', 'rainwalk',
        pg_temp.cat('Pets', 'Pet Food & Supplies'), '10000000-0000-0000-0000-000000000002');
select is(pg_temp.cat_of('RAINWALK PETS'), 'Pets > Pet Care [rule]',
  'account-scoped rule does not apply to other accounts');

select throws_ok(
  $$ insert into public.category_rules (household_id, match_type, pattern, set_category_id)
     values (current_setting('test.h1')::uuid, 'regex', '([unclosed', pg_temp.cat('Other', 'Miscellaneous')) $$,
  '2201B', null, 'invalid regular expressions are rejected');

-- ── Manual override ────────────────────────────────────────────────────────
update public.transactions
set category_id = pg_temp.cat('Pets', 'Pet Food & Supplies'), category_source = 'manual'
where raw_description = 'RAINWALK PETS';

delete from public.category_rules where pattern = 'publix';
select is(pg_temp.cat_of('PUBLIX #503 100926'), '(none) [none]',
  'deleting a rule un-categorises rows it had categorised');
select is(pg_temp.cat_of('PUBLIX SUPER MAR 3695'), 'Food & Dining > Groceries [rule]',
  '...falling back to the next matching rule');

insert into public.category_rules (household_id, priority, field, match_type, pattern, set_category_id)
values (current_setting('test.h1')::uuid, 1, 'description', 'contains', 'pets', pg_temp.cat('Other', 'Miscellaneous'));
select is(pg_temp.cat_of('RAINWALK PETS'), 'Pets > Pet Food & Supplies [manual]',
  'rules never overwrite a manual category');

select throws_ok(
  $$ update public.transactions set category_id = pg_temp.cat('Other', 'Miscellaneous'), category_source = 'manual'
     where status = 'pending' $$,
  '23514', null, 'pending rows cannot be categorised manually');

select throws_ok(
  $$ update public.transactions set category_id = null, category_source = 'manual'
     where raw_description = 'MONARCH MONEY APP' $$,
  '23514', null, 'category and source must agree');

select is(
  public.set_transaction_category(
    array(select id from public.transactions where raw_description in ('MONARCH MONEY APP', 'PUBLIX #503 100926')),
    pg_temp.cat('Other', 'Miscellaneous')),
  1, 'bulk manual categorisation skips pending rows');
select is(pg_temp.cat_of('MONARCH MONEY APP'), 'Other > Miscellaneous [manual]', 'bulk set marks rows manual');
select is(
  public.set_transaction_category(array(select id from public.transactions where raw_description = 'MONARCH MONEY APP'), null),
  1, 'resetting to automatic returns the row count');
select is(pg_temp.cat_of('MONARCH MONEY APP'), 'Entertainment > Subscriptions [rule]',
  'reset to automatic re-applies the rules immediately');

-- ── Tree rules ─────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.categories (household_id, parent_id, name)
     values (current_setting('test.h1')::uuid, pg_temp.cat('Pets', 'Pet Care'), 'Too deep') $$,
  '23514', null, 'categories nest at most one level');

select throws_ok(
  $$ insert into public.categories (household_id, parent_id, name)
     values (current_setting('test.h1')::uuid, (select parent_id from public.categories where id = pg_temp.cat('Pets', 'Pet Care')), 'pet care') $$,
  '23505', null, 'names are unique within a group, case-insensitively');

update public.categories set kind = 'income' where name = 'Pets' and parent_id is null;
select is((select kind::text from public.categories where id = pg_temp.cat('Pets', 'Pet Care')), 'income',
  'changing a group''s kind updates its categories');

select throws_ok(
  $$ delete from public.categories where id = pg_temp.cat('Other', 'Miscellaneous') $$,
  '42501', null, 'categories cannot be deleted (archive instead)');

-- An older export, so the pending rows above are left alone.
select public.import_batch('10000000-0000-0000-0000-000000000001', repeat('f', 64),
  current_setting('test.h1') || '/10000000-0000-0000-0000-000000000001/f.csv', 'f.csv', 'usaa_bank', '2026-10-01',
  $$[
    {"posted_on":"2026-10-06","amount_cents":-2900,"raw_description":"OD FEE - ITEM PAID - ACH - FORD MOTOR CR   FORDCREDI","bank_category":"Auto Payment","status":"posted"},
    {"posted_on":"2026-10-06","amount_cents":-57931,"raw_description":"FORD MOTOR CREDIT","bank_category":"Auto Payment","status":"posted"}
  ]$$::jsonb);
select is(pg_temp.cat_of('OD FEE - ITEM PAID - ACH - FORD MOTOR CR   FORDCREDI'), 'Financial > Fees & Charges [rule]',
  'overdraft fees are fees, even when the bank labels them "Auto Payment"');
select is(pg_temp.cat_of('FORD MOTOR CREDIT'), 'Transfers > Loan Payments [rule]',
  'the loan payment itself is still a loan payment');

-- ── Isolation ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select set_config('test.h2', public.create_household('Other', 'Casey')::text, true);
select set_config('test.foreign_cat', (select c.id::text from public.categories c where c.household_id = current_setting('test.h2')::uuid limit 1), true);

select is((select count(*)::int from public.categories where household_id = current_setting('test.h1')::uuid), 0,
  'other household cannot see categories');
select is((select count(*)::int from public.category_rules where household_id = current_setting('test.h1')::uuid), 0,
  'other household cannot see rules');
select is((select matching from public.preview_category_rule('description', 'contains', 'publix')), 0,
  'preview only sees own transactions');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok(
  $$ update public.transactions set category_id = current_setting('test.foreign_cat')::uuid, category_source = 'manual'
     where raw_description = 'MONARCH MONEY APP' $$,
  '23503', null, 'a transaction cannot use another household''s category');

select * from finish();
rollback;
