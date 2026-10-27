-- Phase 3: household categories, categorisation rules, manual override.
--
-- Model (docs/DESIGN.md §8):
--   * Two-level tree: groups (parent_id null) contain categories. A group's
--     kind (expense | income | transfer) is inherited by its children.
--   * A transaction's category comes from exactly one source:
--       manual  set by a person; never changed by rules
--       rule    first matching rule by priority
--       none    uncategorised
--   * Non-manual categories are always the result of the current rule set:
--     any change to the rules re-categorises the household automatically, and
--     newly inserted transactions are categorised on insert.
--   * Pending rows are categorised by rules only (manual is rejected), since
--     each import replaces them.

create type public.category_kind as enum ('expense', 'income', 'transfer');
create type public.category_source as enum ('none', 'rule', 'manual');
create type public.rule_field as enum ('description', 'bank_category');
create type public.rule_match as enum ('contains', 'starts_with', 'equals', 'regex');

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  parent_id    uuid,
  name         text not null check (length(btrim(name)) between 1 and 60),
  kind         public.category_kind not null default 'expense',
  is_archived  boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, parent_id)
    references public.categories (household_id, id) on delete restrict,
  check (parent_id is distinct from id)
);

create unique index categories_unique_name
  on public.categories (household_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'), lower(btrim(name)));

-- Enforces two levels and kind inheritance.
create function private.categories_enforce_tree()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.categories;
begin
  if new.parent_id is not null then
    select * into v_parent from public.categories where id = new.parent_id;
    if v_parent.parent_id is not null then
      raise exception 'categories can only be nested one level deep' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.categories where parent_id = new.id) then
      raise exception 'a group with categories cannot be moved into another group' using errcode = '23514';
    end if;
    new.kind := v_parent.kind;
  end if;
  return new;
end;
$$;

create trigger categories_enforce_tree
  before insert or update on public.categories
  for each row execute function private.categories_enforce_tree();

-- A group's kind change propagates to its children.
create function private.categories_propagate_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.categories set kind = new.kind
  where parent_id = new.id and kind is distinct from new.kind;
  return null;
end;
$$;

create trigger categories_propagate_kind
  after update of kind on public.categories
  for each row when (new.parent_id is null and old.kind is distinct from new.kind)
  execute function private.categories_propagate_kind();

alter table public.categories enable row level security;

create policy "members read household categories"
  on public.categories for select to authenticated
  using (private.is_member(household_id));

create policy "members add household categories"
  on public.categories for insert to authenticated
  with check (private.is_member(household_id));

create policy "members edit household categories"
  on public.categories for update to authenticated
  using (private.is_member(household_id))
  with check (private.is_member(household_id));

-- No delete: categories are archived, so history keeps its labels.
revoke all on public.categories from anon, authenticated;
grant select on public.categories to authenticated;
grant insert (household_id, parent_id, name, kind, sort_order) on public.categories to authenticated;
grant update (parent_id, name, kind, is_archived, sort_order) on public.categories to authenticated;

-- ---------------------------------------------------------------------------
-- Transactions: category columns
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column category_id uuid,
  add column category_source public.category_source not null default 'none',
  add foreign key (household_id, category_id)
    references public.categories (household_id, id),
  add constraint transactions_category_source_consistent
    check ((category_id is null) = (category_source = 'none')),
  add constraint transactions_pending_not_manual
    check (status = 'posted' or category_source <> 'manual');

create index transactions_category_idx on public.transactions (household_id, category_id);

grant update (category_id, category_source) on public.transactions to authenticated;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

create table public.category_rules (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  priority         integer not null default 100,
  field            public.rule_field not null default 'description',
  match_type       public.rule_match not null default 'contains',
  pattern          text not null check (length(btrim(pattern)) between 1 and 200),
  account_id       uuid,
  -- Range on the absolute amount, so "between $10 and $20" reads naturally.
  amount_min_cents bigint check (amount_min_cents is null or amount_min_cents >= 0),
  amount_max_cents bigint check (amount_max_cents is null or amount_max_cents >= 0),
  set_category_id  uuid not null,
  created_at       timestamptz not null default now(),
  foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete cascade,
  foreign key (household_id, set_category_id)
    references public.categories (household_id, id),
  check (amount_min_cents is null or amount_max_cents is null or amount_min_cents <= amount_max_cents),
  -- Rejects invalid regular expressions at write time.
  check (match_type <> 'regex' or ('' ~* pattern) in (true, false))
);

create index category_rules_household_idx on public.category_rules (household_id, priority);

alter table public.category_rules enable row level security;

create policy "members manage household rules"
  on public.category_rules for all to authenticated
  using (private.is_member(household_id))
  with check (private.is_member(household_id));

revoke all on public.category_rules from anon, authenticated;
grant select, insert, update, delete on public.category_rules to authenticated;

-- ---------------------------------------------------------------------------
-- Rule engine
-- ---------------------------------------------------------------------------

create function private.rule_matches(
  p_raw text, p_display text, p_bank_category text, p_account_id uuid, p_amount_cents bigint,
  p_field public.rule_field, p_match public.rule_match, p_pattern text,
  p_rule_account uuid, p_min bigint, p_max bigint)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    (p_rule_account is null or p_rule_account = p_account_id)
    and (p_min is null or abs(p_amount_cents) >= p_min)
    and (p_max is null or abs(p_amount_cents) <= p_max)
    and exists (
      select 1
      from unnest(case p_field
                    when 'description' then array[p_raw, p_display]
                    else array[coalesce(p_bank_category, '')]
                  end) as v(value)
      where case p_match
              when 'contains'    then strpos(upper(v.value), upper(btrim(p_pattern))) > 0
              when 'starts_with' then left(upper(btrim(v.value)), length(btrim(p_pattern))) = upper(btrim(p_pattern))
              when 'equals'      then upper(btrim(v.value)) = upper(btrim(p_pattern))
              when 'regex'       then v.value ~* p_pattern
            end);
$$;

-- Recomputes rule-based categories for a household (optionally only some
-- transactions). Manual assignments are never touched. Returns rows changed.
create function private.categorise(p_household uuid, p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with target as (
    select t.id,
      (select r.set_category_id
       from public.category_rules r
       where r.household_id = t.household_id
         and private.rule_matches(t.raw_description, t.display_description, t.bank_category,
               t.account_id, t.amount_cents, r.field, r.match_type, r.pattern,
               r.account_id, r.amount_min_cents, r.amount_max_cents)
       order by r.priority, r.created_at, r.id
       limit 1) as category_id
    from public.transactions t
    where t.household_id = p_household
      and t.category_source <> 'manual'
      and (p_ids is null or t.id = any (p_ids))
  )
  update public.transactions t
  set category_id = target.category_id,
      category_source = case when target.category_id is null then 'none' else 'rule' end::public.category_source
  from target
  where t.id = target.id
    and t.category_id is distinct from target.category_id;

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function private.rule_matches(text, text, text, uuid, bigint, public.rule_field,
  public.rule_match, text, uuid, bigint, bigint) from public;
grant execute on function private.rule_matches(text, text, text, uuid, bigint, public.rule_field,
  public.rule_match, text, uuid, bigint, bigint) to authenticated;
revoke all on function private.categorise(uuid, uuid[]) from public;

-- New transactions (imports) are categorised as they arrive.
create function private.categorise_inserted_transactions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  for v_household in select distinct household_id from inserted loop
    perform private.categorise(v_household, (select array_agg(id) from inserted where household_id = v_household));
  end loop;
  return null;
end;
$$;

create trigger transactions_categorise_inserted
  after insert on public.transactions
  referencing new table as inserted
  for each statement execute function private.categorise_inserted_transactions();

-- Any change to the rules re-categorises the affected household(s).
create function private.categorise_after_rule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  for v_household in
    select household_id from changed_new
    union
    select household_id from changed_old
  loop
    perform private.categorise(v_household);
  end loop;
  return null;
end;
$$;

-- Transition tables differ per event (insert has only new rows, delete only
-- old), so insert and delete get their own thin trigger functions.
create function private.categorise_after_rule_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  for v in select distinct household_id from changed_new loop perform private.categorise(v); end loop;
  return null;
end;
$$;

create function private.categorise_after_rule_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  for v in select distinct household_id from changed_old loop perform private.categorise(v); end loop;
  return null;
end;
$$;

create trigger category_rules_after_insert
  after insert on public.category_rules
  referencing new table as changed_new
  for each statement execute function private.categorise_after_rule_insert();

create trigger category_rules_after_update
  after update on public.category_rules
  referencing new table as changed_new old table as changed_old
  for each statement execute function private.categorise_after_rule_change();

create trigger category_rules_after_delete
  after delete on public.category_rules
  referencing old table as changed_old
  for each statement execute function private.categorise_after_rule_delete();

-- Sets a category on one or more transactions (manual), or with a null
-- category hands them back to the rules ("automatic"). Pending rows are left
-- alone when setting a manual category. Returns the number of rows updated.
create function public.set_transaction_category(p_ids uuid[], p_category_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_count     integer;
begin
  select m.household_id into v_household
  from public.household_members m where m.user_id = auth.uid();
  if v_household is null then
    raise exception 'not a household member' using errcode = '42501';
  end if;

  if p_category_id is null then
    update public.transactions
    set category_id = null, category_source = 'none'
    where household_id = v_household and id = any (p_ids) and category_source = 'manual';
    perform private.categorise(v_household, p_ids);
    select count(*) into v_count
    from public.transactions where household_id = v_household and id = any (p_ids);
  else
    if not exists (select 1 from public.categories
                   where id = p_category_id and household_id = v_household) then
      raise exception 'category not found' using errcode = 'P0002';
    end if;
    update public.transactions
    set category_id = p_category_id, category_source = 'manual'
    where household_id = v_household and id = any (p_ids) and status = 'posted';
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;

revoke all on function public.set_transaction_category(uuid[], uuid) from public, anon;
grant execute on function public.set_transaction_category(uuid[], uuid) to authenticated;

-- Preview: what a prospective rule would match, before saving it.
create function public.preview_category_rule(
  p_field public.rule_field,
  p_match_type public.rule_match,
  p_pattern text,
  p_account_id uuid default null,
  p_amount_min_cents bigint default null,
  p_amount_max_cents bigint default null)
returns table (matching integer, manual integer, examples text[])
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_match_type = 'regex' then
    perform '' ~* p_pattern; -- raises 2201B for an invalid expression
  end if;
  return query
  with m as (
    select t.display_description, t.category_source
    from public.transactions t
    where private.rule_matches(t.raw_description, t.display_description, t.bank_category,
            t.account_id, t.amount_cents, p_field, p_match_type, p_pattern,
            p_account_id, p_amount_min_cents, p_amount_max_cents)
  )
  select count(*)::integer,
         (count(*) filter (where m.category_source = 'manual'))::integer,
         (select array_agg(d) from (select distinct m2.display_description as d from m m2 order by 1 limit 5) x)
  from m;
end;
$$;

revoke all on function public.preview_category_rule(public.rule_field, public.rule_match, text, uuid, bigint, bigint)
  from public, anon;
grant execute on function public.preview_category_rule(public.rule_field, public.rule_match, text, uuid, bigint, bigint)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Starter categories and bank-category rules
-- ---------------------------------------------------------------------------

create function private.seed_categories(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  g record;
  c text;
  i integer;
begin
  for g in
    select * from (values
      (1,  'Income',              'income',   array['Paycheck', 'Interest', 'Refunds & Reimbursements', 'Other Income']),
      (2,  'Food & Dining',       'expense',  array['Groceries', 'Restaurants', 'Fast Food', 'Coffee Shops', 'Alcohol & Bars']),
      (3,  'Housing',             'expense',  array['Mortgage Interest & Escrow', 'Home Improvement', 'Home Services', 'Furnishings', 'Other Housing']),
      (4,  'Utilities',           'expense',  array['Electric & Gas', 'Water & Sewer', 'Internet', 'Mobile Phone', 'Streaming & TV', 'Other Utilities']),
      (5,  'Transportation',      'expense',  array['Gas & Fuel', 'Parking & Tolls', 'Rideshare & Taxi', 'Auto Service', 'Auto Insurance']),
      (6,  'Shopping',            'expense',  array['General Merchandise', 'Clothing', 'Electronics & Software', 'Hobbies', 'Sporting Goods', 'Books', 'Shipping']),
      (7,  'Health & Personal',   'expense',  array['Doctor', 'Dentist', 'Pharmacy', 'Personal Care']),
      (8,  'Pets',                'expense',  array['Pet Care', 'Pet Food & Supplies']),
      (9,  'Entertainment',       'expense',  array['Movies & Events', 'Music', 'Subscriptions']),
      (10, 'Travel',              'expense',  array['Travel', 'Vacation']),
      (11, 'Education',           'expense',  array['Education']),
      (12, 'Giving',              'expense',  array['Gifts', 'Donations']),
      (13, 'Financial',           'expense',  array['Fees & Charges', 'Insurance', 'Student Loan', 'Taxes', 'Legal', 'Other Financial']),
      (14, 'Other',               'expense',  array['Cash Withdrawal', 'Business Services', 'Miscellaneous']),
      (15, 'Transfers',           'transfer', array['Between Accounts', 'Credit Card Payments', 'Loan Payments'])
    ) as t(ord, name, kind, children)
  loop
    insert into public.categories (household_id, name, kind, sort_order)
    values (p_household, g.name, g.kind::public.category_kind, g.ord)
    returning id into v_group;
    i := 0;
    foreach c in array g.children loop
      i := i + 1;
      insert into public.categories (household_id, parent_id, name, sort_order)
      values (p_household, v_group, c, i);
    end loop;
  end loop;

  -- Map the bank's own categories (USAA naming) onto ours. Low priority (1000),
  -- so any description rule the household writes (default 100) wins.
  insert into public.category_rules (household_id, priority, field, match_type, pattern, set_category_id)
  select p_household, 1000, 'bank_category', 'equals', m.bank, pc.id
  from (values
    ('Paycheck', 'Income', 'Paycheck'),
    ('Interest Income', 'Income', 'Interest'),
    ('Groceries', 'Food & Dining', 'Groceries'),
    ('Restaurants', 'Food & Dining', 'Restaurants'),
    ('Food & Dining', 'Food & Dining', 'Restaurants'),
    ('Fast Food', 'Food & Dining', 'Fast Food'),
    ('Coffee Shops', 'Food & Dining', 'Coffee Shops'),
    ('Alcohol & Bars', 'Food & Dining', 'Alcohol & Bars'),
    ('Home Improvement', 'Housing', 'Home Improvement'),
    ('Home Services', 'Housing', 'Home Services'),
    ('Furnishings', 'Housing', 'Furnishings'),
    ('Home', 'Housing', 'Other Housing'),
    ('Utilities', 'Utilities', 'Other Utilities'),
    ('Bills & Utilities', 'Utilities', 'Other Utilities'),
    ('Mobile Phone', 'Utilities', 'Mobile Phone'),
    ('Television', 'Utilities', 'Streaming & TV'),
    ('Gas', 'Transportation', 'Gas & Fuel'),
    ('Parking', 'Transportation', 'Parking & Tolls'),
    ('Rental Car & Taxi', 'Transportation', 'Rideshare & Taxi'),
    ('Service & Parts', 'Transportation', 'Auto Service'),
    ('Shopping', 'Shopping', 'General Merchandise'),
    ('Clothing', 'Shopping', 'Clothing'),
    ('Electronics & Software', 'Shopping', 'Electronics & Software'),
    ('Hobbies', 'Shopping', 'Hobbies'),
    ('Sporting Goods', 'Shopping', 'Sporting Goods'),
    ('Books', 'Shopping', 'Books'),
    ('Shipping', 'Shopping', 'Shipping'),
    ('Doctor', 'Health & Personal', 'Doctor'),
    ('Dentist', 'Health & Personal', 'Dentist'),
    ('Pharmacy', 'Health & Personal', 'Pharmacy'),
    ('Personal Care', 'Health & Personal', 'Personal Care'),
    ('Hair', 'Health & Personal', 'Personal Care'),
    ('Pets', 'Pets', 'Pet Care'),
    ('Pet Food & Supplies', 'Pets', 'Pet Food & Supplies'),
    ('Entertainment', 'Entertainment', 'Movies & Events'),
    ('Movies & Dvds', 'Entertainment', 'Movies & Events'),
    ('Music', 'Entertainment', 'Music'),
    ('Newspapers & Magazines', 'Entertainment', 'Subscriptions'),
    ('Travel', 'Travel', 'Travel'),
    ('Vacation', 'Travel', 'Vacation'),
    ('Education', 'Education', 'Education'),
    ('Gifts & Donations', 'Giving', 'Gifts'),
    ('Fees & Charges', 'Financial', 'Fees & Charges'),
    ('Atm Fee', 'Financial', 'Fees & Charges'),
    ('Financial', 'Financial', 'Other Financial'),
    ('Student Loan', 'Financial', 'Student Loan'),
    ('Legal', 'Financial', 'Legal'),
    ('Cash', 'Other', 'Cash Withdrawal'),
    ('Business Services', 'Other', 'Business Services'),
    ('Printing', 'Other', 'Business Services'),
    ('Transfer', 'Transfers', 'Between Accounts'),
    ('Auto Payment', 'Transfers', 'Loan Payments'),
    ('Credit Card Payment', 'Transfers', 'Credit Card Payments')
  ) as m(bank, grp, cat)
  join public.categories pg on pg.household_id = p_household and pg.parent_id is null and pg.name = m.grp
  join public.categories pc on pc.parent_id = pg.id and pc.name = m.cat;

  -- A few description rules for things banks often leave uncategorised.
  insert into public.category_rules (household_id, priority, field, match_type, pattern, set_category_id)
  select p_household, 500, 'description', 'contains', m.pattern, pc.id
  from (values
    ('USAA FUNDS TRANSFER', 'Transfers', 'Between Accounts'),
    ('USAA TRANSFER', 'Transfers', 'Between Accounts')
  ) as m(pattern, grp, cat)
  join public.categories pg on pg.household_id = p_household and pg.parent_id is null and pg.name = m.grp
  join public.categories pc on pc.parent_id = pg.id and pc.name = m.cat;
end;
$$;

revoke all on function private.seed_categories(uuid) from public;

-- New households get the starter set.
create or replace function public.create_household(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.household_members where user_id = v_uid) then
    raise exception 'you already belong to a household' using errcode = '23505';
  end if;

  insert into public.households (name) values (p_name) returning id into v_id;
  insert into public.household_members (household_id, user_id, role, display_name)
    values (v_id, v_uid, 'owner', p_display_name);
  perform private.seed_categories(v_id);
  return v_id;
end;
$$;

-- Existing households get it too (and their transactions are categorised by
-- the rule triggers as the rules are inserted).
do $$
declare
  h uuid;
begin
  for h in select id from public.households loop
    if not exists (select 1 from public.categories where household_id = h) then
      perform private.seed_categories(h);
    end if;
  end loop;
end;
$$;
