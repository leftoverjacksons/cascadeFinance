-- Categorisation for credit card exports (docs/DESIGN.md: Import formats).
--   * Discover's own categories, mapped onto ours (bank-category rules, low
--     priority 1000, like the USAA mapping).
--   * Description rules for what card exports leave uncategorised (American
--     Express has no category column): payments to the card, interest and
--     fees. Payments are transfers, so they pair with the debit from checking.
-- A rule is added only if the household has none with the same field and
-- pattern, so this is safe to re-run and keeps the household's own edits.

create function private.seed_rules_v3(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.category_rules (household_id, priority, field, match_type, pattern, set_category_id)
  select p_household, m.priority, m.field::public.rule_field, m.match::public.rule_match, m.pattern, pc.id
  from (values
    -- Description rules (priority 500): what card exports leave uncategorised.
    (500, 'description', 'contains', 'PAYMENT - THANK YOU', 'Transfers', 'Credit Card Payments'),
    (500, 'description', 'contains', 'INTEREST CHARGE', 'Financial', 'Fees & Charges'),
    (500, 'description', 'contains', 'LATE FEE', 'Financial', 'Fees & Charges'),
    (500, 'description', 'contains', 'MEMBERSHIP FEE', 'Financial', 'Fees & Charges'),
    -- Discover's categories (priority 1000).
    (1000, 'bank_category', 'equals', 'Payments and Credits', 'Transfers', 'Credit Card Payments'),
    (1000, 'bank_category', 'equals', 'Balance Transfers', 'Transfers', 'Between Accounts'),
    (1000, 'bank_category', 'equals', 'Fees', 'Financial', 'Fees & Charges'),
    (1000, 'bank_category', 'equals', 'Interest', 'Financial', 'Fees & Charges'),
    (1000, 'bank_category', 'equals', 'Supermarkets', 'Food & Dining', 'Groceries'),
    (1000, 'bank_category', 'equals', 'Gasoline', 'Transportation', 'Gas & Fuel'),
    (1000, 'bank_category', 'equals', 'Merchandise', 'Shopping', 'General Merchandise'),
    (1000, 'bank_category', 'equals', 'Department Stores', 'Shopping', 'General Merchandise'),
    (1000, 'bank_category', 'equals', 'Warehouse Clubs', 'Shopping', 'General Merchandise'),
    (1000, 'bank_category', 'equals', 'Travel/ Entertainment', 'Travel', 'Travel'),
    (1000, 'bank_category', 'equals', 'Services', 'Other', 'Miscellaneous'),
    (1000, 'bank_category', 'equals', 'Medical Services', 'Health & Personal', 'Doctor'),
    (1000, 'bank_category', 'equals', 'Automotive', 'Transportation', 'Auto Service'),
    (1000, 'bank_category', 'equals', 'Government Services', 'Financial', 'Taxes'),
    (1000, 'bank_category', 'equals', 'Awards and Rebate Credits', 'Income', 'Refunds & Reimbursements')
  ) as m(priority, field, match, pattern, grp, cat)
  join public.categories pg on pg.household_id = p_household and pg.parent_id is null and pg.name = m.grp
  join public.categories pc on pc.parent_id = pg.id and pc.name = m.cat
  where not exists (
    select 1 from public.category_rules r
    where r.household_id = p_household
      and r.field = m.field::public.rule_field
      and upper(btrim(r.pattern)) = upper(m.pattern)
  );
end;
$$;

revoke all on function private.seed_rules_v3(uuid) from public;

-- New households get them too (single seeding entry point).
create or replace function private.seed_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_categories(p_household);
  perform private.seed_rules_v2(p_household);
  perform private.seed_rules_v3(p_household);
  perform private.seed_shared_defaults(p_household);
end;
$$;

revoke all on function private.seed_household(uuid) from public;

-- Existing households (adding rules re-categorises their transactions).
do $$
declare
  h uuid;
begin
  for h in select id from public.households loop
    perform private.seed_rules_v3(h);
  end loop;
end;
$$;
