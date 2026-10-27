-- Phase 5a, part 1: linking the two sides of transfers between household
-- accounts (docs/DESIGN.md §7 "Transfers"), and money flows for the Sankey.
--
-- A link pairs money leaving one account (negative amount) with the same
-- amount arriving in another household account within a few days. Linked
-- transactions are categorised as transfers (category_source = 'transfer'),
-- which rules never override, so both sides drop out of income and spending
-- whatever their wording. Status:
--   auto       the only candidate on both sides
--   suggested  ambiguous (e.g. two equal amounts the same week); shown for review
--   confirmed  confirmed or linked by a person
-- Unlinking records a rejection so the matcher never proposes that pair again.

create type public.transfer_status as enum ('auto', 'suggested', 'confirmed');

create table public.transfer_links (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  out_txn_id   uuid not null unique references public.transactions (id) on delete cascade,
  in_txn_id    uuid not null unique references public.transactions (id) on delete cascade,
  status       public.transfer_status not null,
  created_at   timestamptz not null default now(),
  check (out_txn_id <> in_txn_id)
);

create table public.transfer_rejections (
  household_id uuid not null references public.households (id) on delete cascade,
  out_txn_id   uuid not null references public.transactions (id) on delete cascade,
  in_txn_id    uuid not null references public.transactions (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (out_txn_id, in_txn_id)
);

create index transfer_links_household_idx on public.transfer_links (household_id);
create index transactions_household_amount_idx
  on public.transactions (household_id, amount_cents) where status = 'posted';

alter table public.transfer_links enable row level security;
alter table public.transfer_rejections enable row level security;

create policy "members read household transfer links"
  on public.transfer_links for select to authenticated
  using (private.is_member(household_id));

create policy "members read household transfer rejections"
  on public.transfer_rejections for select to authenticated
  using (private.is_member(household_id));

-- Writes only through the functions below.
revoke all on public.transfer_links, public.transfer_rejections from anon, authenticated;
grant select on public.transfer_links, public.transfer_rejections to authenticated;

-- ---------------------------------------------------------------------------
-- Categories for linked transfers
-- ---------------------------------------------------------------------------

-- The transfer category for a link: card payments and loan payments get their
-- own category, everything else "Between Accounts". Falls back to any active
-- transfer-kind category if the household renamed these.
create function private.transfer_category(p_household uuid, p_in_account uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id
  from public.categories c
  join public.categories g on g.id = c.parent_id
  cross join (
    select case
      when a.type = 'credit_card' then 'Credit Card Payments'
      when a.is_liability then 'Loan Payments'
      else 'Between Accounts'
    end as wanted
    from public.accounts a where a.id = p_in_account
  ) w
  where c.household_id = p_household and g.kind = 'transfer' and not c.is_archived
  order by (c.name = w.wanted) desc, c.sort_order, c.id
  limit 1;
$$;

create function private.transfer_links_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category uuid;
begin
  select private.transfer_category(new.household_id, t.account_id) into v_category
  from public.transactions t where t.id = new.in_txn_id;

  if v_category is not null then
    update public.transactions
    set category_id = v_category, category_source = 'transfer'
    where id in (new.out_txn_id, new.in_txn_id);
  end if;
  return null;
end;
$$;

create trigger transfer_links_after_insert
  after insert on public.transfer_links
  for each row execute function private.transfer_links_after_insert();

-- Unlinking hands both sides back to the rules.
create function private.transfer_links_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.transactions
  set category_id = null, category_source = 'none'
  where id in (old.out_txn_id, old.in_txn_id) and category_source = 'transfer';
  perform private.categorise(old.household_id, array[old.out_txn_id, old.in_txn_id]);
  return null;
end;
$$;

create trigger transfer_links_after_delete
  after delete on public.transfer_links
  for each row execute function private.transfer_links_after_delete();

-- Rules must not override link-derived categories.
create or replace function private.categorise(p_household uuid, p_ids uuid[] default null)
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
      and t.category_source not in ('manual', 'transfer')
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

-- ---------------------------------------------------------------------------
-- Matcher
-- ---------------------------------------------------------------------------

-- Days apart the two sides of a transfer may post.
create function private.transfer_window() returns integer language sql immutable as 'select 4';

-- Links unlinked transfer pairs in a household. Greedy, closest dates first.
-- Returns the number of links created.
create function private.match_transfers(p_household uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_count integer := 0;
begin
  for r in
    with sides as (
      select t.id, t.account_id, t.posted_on, t.amount_cents, t.raw_description, t.category_source,
             c.kind as category_kind
      from public.transactions t
      left join public.categories c on c.id = t.category_id
      where t.household_id = p_household
        and t.status = 'posted'
        and not exists (select 1 from public.transfer_links l
                        where l.out_txn_id = t.id or l.in_txn_id = t.id)
        -- A person said this is not a transfer.
        and not (t.category_source = 'manual' and c.kind is distinct from 'transfer')
    ),
    candidates as (
      select o.id as out_id, i.id as in_id,
             abs(o.posted_on - i.posted_on) as gap, o.posted_on as out_date
      from sides o
      join sides i
        on i.amount_cents = -o.amount_cents
       and i.account_id <> o.account_id
       and abs(o.posted_on - i.posted_on) <= private.transfer_window()
      where o.amount_cents < 0
        and (o.category_kind = 'transfer' or i.category_kind = 'transfer'
             or o.raw_description ~* '(transfer|xfer)' or i.raw_description ~* '(transfer|xfer)')
        and not exists (select 1 from public.transfer_rejections x
                        where x.out_txn_id = o.id and x.in_txn_id = i.id)
    )
    select c.*,
           count(*) over (partition by c.out_id) as out_choices,
           count(*) over (partition by c.in_id) as in_choices
    from candidates c
    order by c.gap, c.out_date, c.out_id, c.in_id
  loop
    if exists (select 1 from public.transfer_links l
               where l.out_txn_id = r.out_id or l.in_txn_id = r.in_id) then
      continue;
    end if;
    insert into public.transfer_links (household_id, out_txn_id, in_txn_id, status)
    values (p_household, r.out_id, r.in_id,
            case when r.out_choices = 1 and r.in_choices = 1 then 'auto' else 'suggested' end::public.transfer_status);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function private.transfer_category(uuid, uuid) from public;
revoke all on function private.match_transfers(uuid) from public;

-- Imports: match after the new rows have been categorised. Statement triggers
-- fire in name order, so this runs after transactions_categorise_inserted.
create function private.match_transfers_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  for v_household in select distinct household_id from inserted loop
    perform private.match_transfers(v_household);
  end loop;
  return null;
end;
$$;

create trigger transactions_match_transfers
  after insert on public.transactions
  referencing new table as inserted
  for each statement execute function private.match_transfers_after_insert();

-- ---------------------------------------------------------------------------
-- Client API
-- ---------------------------------------------------------------------------

create function private.caller_household()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id from public.household_members where user_id = (select auth.uid());
$$;
revoke all on function private.caller_household() from public;

create function public.match_transfers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid := private.caller_household();
begin
  if v_household is null then
    raise exception 'not a household member' using errcode = '42501';
  end if;
  return private.match_transfers(v_household);
end;
$$;

-- Links two transactions by hand (status confirmed). Either may be given first.
create function public.link_transfer(p_a uuid, p_b uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid := private.caller_household();
  v_out       public.transactions;
  v_in        public.transactions;
  v_id        uuid;
begin
  select * into v_out from public.transactions
  where id in (p_a, p_b) and household_id = v_household and amount_cents < 0;
  select * into v_in from public.transactions
  where id in (p_a, p_b) and household_id = v_household and amount_cents > 0;

  if v_out.id is null or v_in.id is null then
    raise exception 'a transfer needs one outgoing and one incoming transaction in your household'
      using errcode = '22023';
  end if;
  if v_out.account_id = v_in.account_id then
    raise exception 'both sides are in the same account' using errcode = '22023';
  end if;
  if v_out.status <> 'posted' or v_in.status <> 'posted' then
    raise exception 'pending transactions cannot be linked' using errcode = '22023';
  end if;

  delete from public.transfer_links where out_txn_id in (v_out.id, v_in.id) or in_txn_id in (v_out.id, v_in.id);
  delete from public.transfer_rejections where out_txn_id = v_out.id and in_txn_id = v_in.id;
  -- A manual category on either side would block the link-derived one.
  update public.transactions set category_id = null, category_source = 'none'
  where id in (v_out.id, v_in.id) and category_source = 'manual';

  insert into public.transfer_links (household_id, out_txn_id, in_txn_id, status)
  values (v_household, v_out.id, v_in.id, 'confirmed')
  returning id into v_id;
  return v_id;
end;
$$;

create function public.confirm_transfer(p_link uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.transfer_links set status = 'confirmed'
  where id = p_link and household_id = private.caller_household();
  if not found then
    raise exception 'transfer link not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.unlink_transfer(p_link uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.transfer_links;
begin
  delete from public.transfer_links
  where id = p_link and household_id = private.caller_household()
  returning * into v_link;
  if v_link.id is null then
    raise exception 'transfer link not found' using errcode = 'P0002';
  end if;
  insert into public.transfer_rejections (household_id, out_txn_id, in_txn_id)
  values (v_link.household_id, v_link.out_txn_id, v_link.in_txn_id)
  on conflict do nothing;
end;
$$;

-- Choosing a non-transfer category by hand means "this is not a transfer":
-- the link is removed (and rejected) before the category is set.
create or replace function public.set_transaction_category(p_ids uuid[], p_category_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_count     integer;
  v_kind      public.category_kind;
  v_link      public.transfer_links;
begin
  v_household := private.caller_household();
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
    return v_count;
  end if;

  select kind into v_kind from public.categories
  where id = p_category_id and household_id = v_household;
  if v_kind is null then
    raise exception 'category not found' using errcode = 'P0002';
  end if;

  if v_kind <> 'transfer' then
    for v_link in
      delete from public.transfer_links
      where household_id = v_household and (out_txn_id = any (p_ids) or in_txn_id = any (p_ids))
      returning *
    loop
      insert into public.transfer_rejections (household_id, out_txn_id, in_txn_id)
      values (v_link.household_id, v_link.out_txn_id, v_link.in_txn_id)
      on conflict do nothing;
    end loop;
  end if;

  update public.transactions
  set category_id = p_category_id, category_source = 'manual'
  where household_id = v_household and id = any (p_ids) and status = 'posted';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Possible other sides for a transaction, best first: equal amount, then
-- closest date. Reads through RLS.
create function public.transfer_candidates(p_txn uuid)
returns table (
  id                  uuid,
  account_id          uuid,
  posted_on           date,
  amount_cents        bigint,
  display_description text,
  exact_amount        boolean,
  gap_days            integer,
  already_linked      boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.account_id, c.posted_on, c.amount_cents, c.display_description,
         c.amount_cents = -t.amount_cents,
         abs(c.posted_on - t.posted_on),
         exists (select 1 from public.transfer_links l where l.out_txn_id = c.id or l.in_txn_id = c.id)
  from public.transactions t
  join public.transactions c
    on c.household_id = t.household_id
   and c.account_id <> t.account_id
   and c.status = 'posted'
   and sign(c.amount_cents) = -sign(t.amount_cents)
   and abs(c.posted_on - t.posted_on) <= 10
  where t.id = p_txn
  order by (c.amount_cents = -t.amount_cents) desc, abs(c.posted_on - t.posted_on), c.id
  limit 20;
$$;

-- Money flows for the Sankey diagram, over posted transactions in a date range.
--   income     income category (or uncategorised money in) -> account
--   spend      account -> spending group (or uncategorised money out); net of refunds
--   transfer   account -> account, from linked transfers (dated by the outgoing side)
--   out_other  account -> transfer category, for unlinked money leaving (e.g. loan payments)
--   in_other   transfer category -> account, for unlinked money arriving
create function public.money_flows(p_from date, p_to date)
returns table (kind text, source text, target text, cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with t as (
    select t.*, c.kind as category_kind, coalesce(c.parent_id, c.id) as group_id,
           exists (select 1 from public.transfer_links l where l.out_txn_id = t.id or l.in_txn_id = t.id) as linked
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.status = 'posted' and t.posted_on between p_from and p_to
  )
  select 'income', coalesce(category_id::text, 'uncategorized'), account_id::text, sum(amount_cents)::bigint
  from t
  where not linked and amount_cents > 0 and (category_kind = 'income' or category_id is null)
  group by 2, 3
  union all
  select 'spend', account_id::text, coalesce(group_id::text, 'uncategorized'), (-sum(amount_cents))::bigint
  from t
  where not linked and (category_kind = 'expense' or (category_id is null and amount_cents < 0))
  group by 2, 3
  having -sum(amount_cents) > 0
  union all
  select 'transfer', o.account_id::text, i.account_id::text, sum(-o.amount_cents)::bigint
  from public.transfer_links l
  join public.transactions o on o.id = l.out_txn_id
  join public.transactions i on i.id = l.in_txn_id
  where o.posted_on between p_from and p_to
  group by 2, 3
  union all
  select 'out_other', account_id::text, category_id::text, (-sum(amount_cents))::bigint
  from t
  where not linked and category_kind = 'transfer' and amount_cents < 0
  group by 2, 3
  union all
  select 'in_other', category_id::text, account_id::text, sum(amount_cents)::bigint
  from t
  where not linked and category_kind = 'transfer' and amount_cents > 0
  group by 2, 3;
$$;

revoke all on function public.match_transfers() from public, anon;
revoke all on function public.link_transfer(uuid, uuid) from public, anon;
revoke all on function public.confirm_transfer(uuid) from public, anon;
revoke all on function public.unlink_transfer(uuid) from public, anon;
revoke all on function public.transfer_candidates(uuid) from public, anon;
revoke all on function public.money_flows(date, date) from public, anon;
grant execute on function public.match_transfers() to authenticated;
grant execute on function public.link_transfer(uuid, uuid) to authenticated;
grant execute on function public.confirm_transfer(uuid) to authenticated;
grant execute on function public.unlink_transfer(uuid) to authenticated;
grant execute on function public.transfer_candidates(uuid) to authenticated;
grant execute on function public.money_flows(date, date) to authenticated;

-- Link transfers already imported.
do $$
declare
  h uuid;
begin
  for h in select id from public.households loop
    perform private.match_transfers(h);
  end loop;
end;
$$;
