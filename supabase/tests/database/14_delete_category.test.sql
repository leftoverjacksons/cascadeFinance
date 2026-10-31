-- Deleting a category: its transactions are unassigned and re-offered to the
-- remaining rules; its rules go; groups take their categories with them;
-- transfer categories are kept.

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h', public.create_household('Home', 'A')::text, true);
insert into public.accounts (id, household_id, name, type) values
  ('10000000-0000-0000-0000-00000000000a', current_setting('test.h')::uuid, 'Checking', 'checking');

create function pg_temp.cat(p_name text) returns uuid language sql as $$
  select id from public.categories where name = p_name and household_id = current_setting('test.h')::uuid;
$$;
create function pg_temp.cat_of(p_raw text) returns text language sql as $$
  select coalesce(c.name, '(none)') || ' [' || t.category_source || ']'
  from public.transactions t left join public.categories c on c.id = t.category_id
  where t.raw_description = p_raw;
$$;
grant execute on function pg_temp.cat(text) to authenticated;
grant execute on function pg_temp.cat_of(text) to authenticated;

-- A new group with a category, a rule for it, and a manual assignment.
insert into public.categories (household_id, name, kind, sort_order) values (current_setting('test.h')::uuid, 'Kids', 'expense', 99);
insert into public.categories (household_id, parent_id, name, sort_order) values (current_setting('test.h')::uuid, pg_temp.cat('Kids'), 'Daycare', 1);
insert into public.category_rules (household_id, field, match_type, pattern, set_category_id)
values (current_setting('test.h')::uuid, 'description', 'contains', 'LITTLE STARS', pg_temp.cat('Daycare'));

select public.import_batch('10000000-0000-0000-0000-00000000000a'::uuid, encode(sha256('f'::bytea), 'hex'),
  current_setting('test.h') || '/10000000-0000-0000-0000-00000000000a/f.csv', 'f.csv', 'usaa_bank', '2026-10-31', $$[
  {"posted_on":"2026-10-01","amount_cents":-50000,"raw_description":"LITTLE STARS DAYCARE","display_description":null,"bank_category":"Education","status":"posted"},
  {"posted_on":"2026-10-02","amount_cents":-2500,"raw_description":"TOY SHOP","display_description":null,"bank_category":null,"status":"posted"},
  {"posted_on":"2026-10-03","amount_cents":-1200,"raw_description":"KROGER","display_description":null,"bank_category":"Groceries","status":"posted"}
]$$::jsonb);
select public.set_transaction_category(array[(select id from public.transactions where raw_description = 'TOY SHOP')], pg_temp.cat('Daycare'));
select public.set_transaction_category(array[(select id from public.transactions where raw_description = 'KROGER')], pg_temp.cat('Daycare'));

select is(pg_temp.cat_of('LITTLE STARS DAYCARE'), 'Daycare [rule]', 'set up: a rule assigns it');

select is(public.delete_category(pg_temp.cat('Daycare')), 3, 'deleting it reports its three transactions');
select is(pg_temp.cat_of('TOY SHOP'), '(none) [none]', 'a manual assignment becomes uncategorised');
select is(pg_temp.cat_of('KROGER'), 'Groceries [rule]', 'the remaining rules get another go (bank category: Groceries)');
select is(pg_temp.cat_of('LITTLE STARS DAYCARE'), 'Education [rule]', 'its own rule is gone; the next rule applies');
select is((select count(*)::int from public.category_rules where pattern = 'LITTLE STARS'), 0, 'rules that set it are removed');

-- A group takes its categories with it.
insert into public.categories (household_id, parent_id, name, sort_order) values (current_setting('test.h')::uuid, pg_temp.cat('Kids'), 'School', 2);
select public.delete_category(pg_temp.cat('Kids'));
select is((select count(*)::int from public.categories where name in ('Kids', 'School')), 0, 'deleting a group deletes its categories');

select throws_ok($$ select public.delete_category(pg_temp.cat('Credit Card Payments')) $$, '22023', null,
  'transfer categories cannot be deleted');
select throws_ok($$ select public.delete_category(pg_temp.cat('Transfers')) $$, '22023', null,
  'nor the Transfers group');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select public.create_household('Other', 'C');
select throws_ok(format('select public.delete_category(%L)', (select id from public.categories c
  where c.household_id = current_setting('test.h')::uuid and c.name = 'Pets')), '42501', null,
  'another household cannot delete it');

select * from finish();
rollback;
