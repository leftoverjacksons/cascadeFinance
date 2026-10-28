-- Phase 5a part 2: shared expenses, paybacks and the member balance
-- (docs/DESIGN.md §9a).
--
--   * Who paid: from the account. A personal account (owner_user_id set) means
--     that member; a joint account means everyone, so it creates no debt.
--   * What is shared: categories carry a "shared by default" flag; any
--     transaction can override it (transactions.shared_override).
--   * Split: household_members.split_weight (equal weights = 50/50).
--   * Joint accounts are a shared pot: money a member puts in counts as
--     paying toward shared costs, money taken out to a personal account counts
--     against them, and spending from the pot creates no debt.
--   * Paybacks: a transfer between two members' personal accounts. Any of
--     these movements can be excluded (settlement_overrides). Payments outside
--     the accounts (cash, Venmo) are recorded in manual_settlements.
--   * The ledger starts at households.shared_since (null = all history).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.categories add column is_shared boolean not null default false;
grant insert (is_shared), update (is_shared) on public.categories to authenticated;

-- null = use the category's default; true/false = this transaction is / isn't shared.
alter table public.transactions add column shared_override boolean;
grant update (shared_override) on public.transactions to authenticated;

alter table public.households add column shared_since date;
grant update (shared_since) on public.households to authenticated;

create table public.settlement_overrides (
  -- The outgoing transaction of a member-to-member payment (first hop when it
  -- went through a joint account). Keyed by transaction, not link, so the
  -- decision survives automatic links being recomputed.
  out_txn_id    uuid primary key references public.transactions (id) on delete cascade,
  household_id  uuid not null references public.households (id) on delete cascade,
  is_settlement boolean not null,
  created_at    timestamptz not null default now()
);

alter table public.settlement_overrides enable row level security;
create policy "members manage household settlement overrides"
  on public.settlement_overrides for all to authenticated
  using (private.is_member(household_id))
  with check (private.is_member(household_id));
revoke all on public.settlement_overrides from anon, authenticated;
grant select, insert, update, delete on public.settlement_overrides to authenticated;

create table public.manual_settlements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  from_user_id uuid not null,
  to_user_id   uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  settled_on   date not null,
  note         text check (note is null or length(note) <= 200),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (household_id, from_user_id) references public.household_members (household_id, user_id) on delete cascade,
  foreign key (household_id, to_user_id) references public.household_members (household_id, user_id) on delete cascade,
  check (from_user_id <> to_user_id)
);

alter table public.manual_settlements enable row level security;
create policy "members manage household manual settlements"
  on public.manual_settlements for all to authenticated
  using (private.is_member(household_id))
  with check (private.is_member(household_id));
revoke all on public.manual_settlements from anon, authenticated;
grant select, insert, update, delete on public.manual_settlements to authenticated;

-- ---------------------------------------------------------------------------
-- Seeding: one entry point for new households from now on
-- ---------------------------------------------------------------------------

create function private.seed_shared_defaults(p_household uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.categories c
  set is_shared = true
  from public.categories g
  where c.household_id = p_household
    and g.id = coalesce(c.parent_id, c.id)
    and (g.name in ('Housing', 'Utilities', 'Pets') or c.name = 'Groceries');
$$;

create function private.seed_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_categories(p_household);
  perform private.seed_rules_v2(p_household);
  perform private.seed_shared_defaults(p_household);
end;
$$;

revoke all on function private.seed_shared_defaults(uuid) from public;
revoke all on function private.seed_household(uuid) from public;

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
  perform private.seed_household(v_id);
  return v_id;
end;
$$;

do $$
declare
  h uuid;
begin
  for h in select id from public.households loop
    perform private.seed_shared_defaults(h);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Transfer matching: Zelle counts as transfer wording too
-- ---------------------------------------------------------------------------

create function private.looks_like_transfer(p_description text)
returns boolean
language sql
immutable
as $$
  select p_description ~* '(transfer|xfer|zelle)'
$$;

-- Order-independent matching: automatic and suggested links are recomputed
-- from scratch on every run (closest dates first), so the result does not
-- depend on the order in which accounts were imported. Confirmed links and
-- rejected pairs are kept. Returns the change in the number of links.
create or replace function private.match_transfers(p_household uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_before integer;
begin
  select count(*) into v_before from public.transfer_links where household_id = p_household;
  delete from public.transfer_links where household_id = p_household and status <> 'confirmed';

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
             or private.looks_like_transfer(o.raw_description) or private.looks_like_transfer(i.raw_description))
        and not exists (select 1 from public.transfer_rejections x
                        where x.out_txn_id = o.id and x.in_txn_id = i.id)
    ),
    ranked as (
      select c.*,
             count(*) over (partition by c.out_id) as out_choices,
             count(*) over (partition by c.in_id) as in_choices
      from candidates c
    )
  -- Most constrained first (a transaction with a single possible partner must
  -- not lose it to one that has alternatives), then closest dates.
  select * from ranked
  order by least(out_choices, in_choices), gap, out_date, out_id, in_id
  loop
    if exists (select 1 from public.transfer_links l
               where l.out_txn_id = r.out_id or l.in_txn_id = r.in_id) then
      continue;
    end if;
    insert into public.transfer_links (household_id, out_txn_id, in_txn_id, status)
    values (p_household, r.out_id, r.in_id,
            case when r.out_choices = 1 and r.in_choices = 1 then 'auto' else 'suggested' end::public.transfer_status);
  end loop;
  return (select count(*) from public.transfer_links where household_id = p_household) - v_before;
end;
$$;

-- Manual link / unlink / "not a transfer" free up other transactions; re-run
-- the matcher at the end of each so they re-pair straight away (after the
-- rejection or new link is in place, so the change itself sticks).

create or replace function public.link_transfer(p_a uuid, p_b uuid)
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
  perform private.match_transfers(v_household);
  return v_id;
end;
$$;

create or replace function public.unlink_transfer(p_link uuid)
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
  perform private.match_transfers(v_link.household_id);
end;
$$;

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
  -- Removed links may free other transactions to pair differently.
  perform private.match_transfers(v_household);
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Money moving between members and the joint pot
-- ---------------------------------------------------------------------------
--
-- Contribution model (docs/DESIGN.md §9a, revised 2026-10-28): joint accounts
-- are a shared pot that pays shared costs (e.g. the mortgage). Each linked
-- transfer with a personal account on at least one side is one of:
--   payback       personal -> another member's personal account
--   contribution  personal -> joint   (that member paid toward shared costs)
--   withdrawal    joint -> personal   (that member took shared money back)
-- Transfers between a member's own accounts, and between joint accounts, are
-- not listed. Spending from joint accounts creates no debt: the pot paid it.
-- A two-hop transfer (A -> joint -> B) nets to a payback from A to B.
-- Each entry counts unless switched off (settlement_overrides, keyed by the
-- outgoing transaction so it survives re-matching).

create function public.member_transfers()
returns table (
  link_id      uuid,
  out_txn_id   uuid,
  kind         text,
  from_user    uuid,   -- null when the money left a joint account
  to_user      uuid,   -- null when the money went into a joint account
  from_account uuid,
  to_account   uuid,
  sent_on      date,
  received_on  date,
  amount_cents bigint,
  counted      boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id, l.out_txn_id,
         case
           when ao.owner_user_id is not null and ai.owner_user_id is not null then 'payback'
           when ao.owner_user_id is not null then 'contribution'
           else 'withdrawal'
         end,
         ao.owner_user_id, ai.owner_user_id, ao.id, ai.id,
         o.posted_on, i.posted_on, -o.amount_cents,
         coalesce(so.is_settlement, true)
  from public.transfer_links l
  join public.transactions o on o.id = l.out_txn_id
  join public.transactions i on i.id = l.in_txn_id
  join public.accounts ao on ao.id = o.account_id
  join public.accounts ai on ai.id = i.account_id
  left join public.settlement_overrides so on so.out_txn_id = l.out_txn_id
  where (ao.owner_user_id is not null or ai.owner_user_id is not null)
    and ao.owner_user_id is distinct from ai.owner_user_id
  order by i.posted_on desc, l.id;
$$;

-- ---------------------------------------------------------------------------
-- Ledger: every entry that moves the balance between two members
-- ---------------------------------------------------------------------------
--   debtor owes creditor `cents` because of this entry.
--   expense       shared expense paid from the creditor's personal account;
--                 one row per other member, for their share
--   contribution  creditor put money into a joint account; one row per other
--                 member, for their share
--   withdrawal    debtor took money out of a joint account; one row per other
--                 member (the creditor), for that member's share
--   payback       a transfer between personal accounts: the receiver owes the sender
--   manual        a payment recorded by hand

create function public.shared_ledger()
returns table (
  entry_kind   text,
  entry_date   date,
  ref_id       uuid,
  description  text,
  total_cents  bigint,
  debtor       uuid,
  creditor     uuid,
  cents        bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with h as (
    select hh.shared_since, (select sum(m.split_weight) from public.household_members m) as total_weight
    from public.households hh
    limit 1
  ),
  members as (
    select m.user_id, m.split_weight from public.household_members m
  ),
  since as (
    select coalesce((select shared_since from h), '-infinity'::date) as d
  ),
  shared_txns as (
    select t.id, t.posted_on, t.display_description, -t.amount_cents as spent, a.owner_user_id as payer
    from public.transactions t
    join public.accounts a on a.id = t.account_id
    left join public.categories c on c.id = t.category_id
    where t.status = 'posted'
      and a.owner_user_id is not null
      and coalesce(t.shared_override, c.is_shared, false)
      and (c.kind = 'expense' or t.category_id is null)
      and not exists (select 1 from public.transfer_links l where l.out_txn_id = t.id or l.in_txn_id = t.id)
      and t.posted_on >= (select d from since)
  ),
  moves as (
    select * from public.member_transfers() mt
    where mt.counted and mt.received_on >= (select d from since)
  )
  select 'expense', s.posted_on, s.id, s.display_description, s.spent, m.user_id, s.payer,
         round(s.spent * m.split_weight / (select total_weight from h))::bigint
  from shared_txns s
  join members m on m.user_id <> s.payer
  union all
  select 'contribution', mv.received_on, mv.out_txn_id, 'Into joint account', mv.amount_cents, m.user_id, mv.from_user,
         round(mv.amount_cents * m.split_weight / (select total_weight from h))::bigint
  from moves mv
  join members m on m.user_id <> mv.from_user
  where mv.kind = 'contribution'
  union all
  select 'withdrawal', mv.received_on, mv.out_txn_id, 'Out of joint account', mv.amount_cents, mv.to_user, m.user_id,
         round(mv.amount_cents * m.split_weight / (select total_weight from h))::bigint
  from moves mv
  join members m on m.user_id <> mv.to_user
  where mv.kind = 'withdrawal'
  union all
  select 'payback', mv.received_on, mv.out_txn_id, 'Transfer', mv.amount_cents, mv.to_user, mv.from_user, mv.amount_cents
  from moves mv
  where mv.kind = 'payback'
  union all
  select 'manual', ms.settled_on, ms.id, coalesce(ms.note, 'Payment'), ms.amount_cents,
         ms.to_user_id, ms.from_user_id, ms.amount_cents
  from public.manual_settlements ms
  where ms.settled_on >= (select d from since)
  order by 2 desc, 1, 3;
$$;

revoke all on function public.member_transfers() from public, anon;
revoke all on function public.shared_ledger() from public, anon;
grant execute on function public.member_transfers() to authenticated;
grant execute on function public.shared_ledger() to authenticated;

-- Re-run the (now order-independent) matcher over existing data, so links
-- made under the old import-order-dependent logic are corrected.
do $$
declare
  h uuid;
begin
  for h in select id from public.households loop
    perform private.match_transfers(h);
  end loop;
end;
$$;
