-- Phase 4: reporting functions for the Overview screen.
--
-- Both are SECURITY INVOKER: they read through RLS, so a caller only ever
-- aggregates their own household's rows. Pending transactions are excluded
-- (they are replaced on every import and would double-count once posted).

-- Monthly totals per category, split into money in and money out so the client
-- can treat uncategorised rows by direction and expense refunds as net.
create function public.monthly_category_totals(p_from date, p_to date)
returns table (
  month         date,
  category_id   uuid,
  inflow_cents  bigint,
  outflow_cents bigint,
  txn_count     integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    date_trunc('month', t.posted_on)::date,
    t.category_id,
    coalesce(sum(t.amount_cents) filter (where t.amount_cents > 0), 0)::bigint,
    coalesce(sum(t.amount_cents) filter (where t.amount_cents < 0), 0)::bigint,
    count(*)::integer
  from public.transactions t
  where t.status = 'posted'
    and t.posted_on >= p_from
    and t.posted_on <= p_to
  group by 1, 2
  order by 1, 2;
$$;

-- Estimated balance of each account at each requested date.
--
-- Balances are anchored on balance_snapshots (from imports or entered from
-- statements) and rolled forward/backward with posted transactions:
--   * anchor = latest snapshot on or before the date, else the earliest after it
--   * forward:  balance = anchor + sum(amounts in (anchor date, date])
--   * backward: balance = anchor - sum(amounts in (date, anchor date])
-- Snapshots of liabilities are entered as the amount owed (positive); the
-- result is signed, so liabilities come back negative and assets positive and
-- net worth is a plain sum. Accounts with no snapshot are omitted.
create function public.balance_history(p_dates date[])
returns table (
  account_id    uuid,
  as_of         date,
  balance_cents bigint,
  anchor_date   date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with dates as (
    select distinct d::date as d from unnest(p_dates) as u(d)
  ),
  snaps as (
    select distinct on (s.account_id, s.as_of)
      s.account_id, s.as_of,
      case when a.is_liability then -s.balance_cents else s.balance_cents end as signed_cents
    from public.balance_snapshots s
    join public.accounts a on a.id = s.account_id
    order by s.account_id, s.as_of, s.created_at desc
  ),
  unpacked as (
    select a.account_id, dates.d, anchor.as_of as anchor_date, anchor.signed_cents as anchor_cents
    from (select distinct account_id from snaps) a
    cross join dates
    cross join lateral (
      select * from (
        (select s.as_of, s.signed_cents, 0 as pref from snaps s
         where s.account_id = a.account_id and s.as_of <= dates.d
         order by s.as_of desc limit 1)
        union all
        (select s.as_of, s.signed_cents, 1 as pref from snaps s
         where s.account_id = a.account_id and s.as_of > dates.d
         order by s.as_of asc limit 1)
      ) c
      order by c.pref
      limit 1
    ) anchor
  )
  select u.account_id, u.d,
    u.anchor_cents + case
      when u.anchor_date <= u.d then coalesce((
        select sum(t.amount_cents) from public.transactions t
        where t.account_id = u.account_id and t.status = 'posted'
          and t.posted_on > u.anchor_date and t.posted_on <= u.d), 0)
      else -coalesce((
        select sum(t.amount_cents) from public.transactions t
        where t.account_id = u.account_id and t.status = 'posted'
          and t.posted_on > u.d and t.posted_on <= u.anchor_date), 0)
    end,
    u.anchor_date
  from unpacked u
  order by u.account_id, u.d;
$$;

revoke all on function public.monthly_category_totals(date, date) from public, anon;
revoke all on function public.balance_history(date[]) from public, anon;
grant execute on function public.monthly_category_totals(date, date) to authenticated;
grant execute on function public.balance_history(date[]) to authenticated;
