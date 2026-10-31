-- Credit card imports: categorisation of card rows, and card payments pairing
-- with the debit from checking. Rows are as the app's card formats produce
-- them (amounts already flipped: negative = a charge on the card).

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select set_config('test.h', public.create_household('Home', 'A')::text, true);

insert into public.accounts (id, household_id, name, type) values
  ('10000000-0000-0000-0000-00000000000a', current_setting('test.h')::uuid, 'Checking', 'checking'),
  ('10000000-0000-0000-0000-0000000000d1', current_setting('test.h')::uuid, 'Discover', 'credit_card'),
  ('10000000-0000-0000-0000-0000000000e1', current_setting('test.h')::uuid, 'Amex', 'credit_card');

create function pg_temp.imp(p_account text, p_seed text, p_format text, p_rows text) returns void language sql as $$
  select public.import_batch(p_account::uuid, encode(sha256(convert_to(p_seed, 'UTF8')), 'hex'),
    current_setting('test.h') || '/' || p_account || '/' || p_seed || '.csv', p_seed, p_format, '2026-10-31',
    p_rows::jsonb)::text::void;
$$;
create function pg_temp.cat_of(p_raw text) returns text language sql as $$
  select coalesce(g.name || ' > ' || c.name, '(none)')
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  left join public.categories g on g.id = c.parent_id
  where t.raw_description = p_raw;
$$;
grant execute on function pg_temp.imp(text, text, text, text) to authenticated;
grant execute on function pg_temp.cat_of(text) to authenticated;

select pg_temp.imp('10000000-0000-0000-0000-00000000000a', 'chk', 'usaa_bank', $$[
  {"posted_on":"2026-06-29","amount_cents":-15000,"raw_description":"DISCOVER E-PAYMENT 1234","display_description":"Discover","bank_category":"Credit Card Payment","status":"posted"}
]$$);
select pg_temp.imp('10000000-0000-0000-0000-0000000000d1', 'disc', 'discover_card', $$[
  {"posted_on":"2026-06-30","amount_cents":15000,"raw_description":"INTERNET PAYMENT - THANK YOU","display_description":"Internet Payment - Thank You","bank_category":"Payments and Credits","status":"posted"},
  {"posted_on":"2026-06-12","amount_cents":-300000,"raw_description":"EXAMPLE BANK ******1234BT IAPR 0.00%","display_description":null,"bank_category":"Balance Transfers","status":"posted"},
  {"posted_on":"2026-07-16","amount_cents":-37,"raw_description":"INTEREST CHARGE ON PURCHASES","display_description":null,"bank_category":"Interest","status":"posted"},
  {"posted_on":"2026-07-20","amount_cents":-4210,"raw_description":"EXAMPLE GROCER #12","display_description":null,"bank_category":"Supermarkets","status":"posted"}
]$$);
select pg_temp.imp('10000000-0000-0000-0000-0000000000e1', 'amex', 'amex_card', $$[
  {"posted_on":"2026-08-09","amount_cents":12000,"raw_description":"ONLINE PAYMENT - THANK YOU","display_description":null,"bank_category":null,"status":"posted"},
  {"posted_on":"2026-05-01","amount_cents":-4000,"raw_description":"LATE FEE","display_description":null,"bank_category":null,"status":"posted"},
  {"posted_on":"2026-10-07","amount_cents":-9500,"raw_description":"RENEWAL MEMBERSHIP FEE","display_description":null,"bank_category":null,"status":"posted"}
]$$);

select is(pg_temp.cat_of('INTERNET PAYMENT - THANK YOU'), 'Transfers > Credit Card Payments', 'a payment to the card is a transfer');
select is(pg_temp.cat_of('ONLINE PAYMENT - THANK YOU'), 'Transfers > Credit Card Payments', 'also without a bank category (American Express)');
select is(pg_temp.cat_of('EXAMPLE BANK ******1234BT IAPR 0.00%'), 'Transfers > Between Accounts', 'a balance transfer moves debt: not spending');
select is(pg_temp.cat_of('INTEREST CHARGE ON PURCHASES'), 'Financial > Fees & Charges', 'interest charged is a cost');
select is(pg_temp.cat_of('RENEWAL MEMBERSHIP FEE'), 'Financial > Fees & Charges', 'so is the annual fee');
select is(pg_temp.cat_of('EXAMPLE GROCER #12'), 'Food & Dining > Groceries', 'Discover purchase categories map onto ours');
select is(
  (select count(*)::int from public.transfer_links l
   join public.transactions o on o.id = l.out_txn_id
   where o.raw_description = 'DISCOVER E-PAYMENT 1234'),
  1, 'the payment pairs with the debit from checking');

reset role;
select set_config('test.rules', (select count(*)::text from public.category_rules where household_id = current_setting('test.h')::uuid), true);
select private.seed_rules_v3(current_setting('test.h')::uuid);
select is((select count(*)::text from public.category_rules where household_id = current_setting('test.h')::uuid),
  current_setting('test.rules'), 'adding the rules again adds nothing');

select * from finish();
rollback;
