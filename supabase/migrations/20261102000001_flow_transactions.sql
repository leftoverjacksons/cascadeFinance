-- Money-flow drill-down (docs/DESIGN.md: Sankey):
--   * the transactions behind one flow of the money-flow diagram;
--   * per-person saved positions of dragged diagram nodes.
--
-- money_flows (the diagram's totals) and money_flow_transactions (the rows
-- behind a flow) share one definition of which transaction feeds which flow,
-- private.money_flow_edges, so the list always adds up to the diagram.

-- One row per transaction and the flow it feeds. cents has the sign
-- money_flows sums: positive for money moving along the flow (refunds on
-- spending are negative).
create function private.money_flow_edges(p_from date, p_to date)
returns table (txn_id uuid, kind text, source text, target text, cents bigint)
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
  select id, 'income', coalesce(category_id::text, 'uncategorized'), account_id::text, amount_cents
  from t
  where not linked and amount_cents > 0 and (category_kind = 'income' or category_id is null)
  union all
  select id, 'spend', account_id::text, coalesce(group_id::text, 'uncategorized'), -amount_cents
  from t
  where not linked and (category_kind = 'expense' or (category_id is null and amount_cents < 0))
  union all
  -- A linked transfer is listed by its outgoing side.
  select o.id, 'transfer', o.account_id::text, i.account_id::text, -o.amount_cents
  from public.transfer_links l
  join public.transactions o on o.id = l.out_txn_id
  join public.transactions i on i.id = l.in_txn_id
  where o.posted_on between p_from and p_to
  union all
  select id, 'out_other', account_id::text, category_id::text, -amount_cents
  from t
  where not linked and category_kind = 'transfer' and amount_cents < 0
  union all
  select id, 'in_other', category_id::text, account_id::text, amount_cents
  from t
  where not linked and category_kind = 'transfer' and amount_cents > 0;
$$;

create or replace function public.money_flows(p_from date, p_to date)
returns table (kind text, source text, target text, cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select kind, source, target, sum(cents)::bigint
  from private.money_flow_edges(p_from, p_to)
  group by kind, source, target
  -- Spending groups refunded more than was spent draw nothing.
  having kind <> 'spend' or sum(cents) > 0;
$$;

-- The transactions behind the given flows (parallel arrays of kind, source,
-- target as money_flows returns them), newest first.
create function public.money_flow_transactions(
  p_from date, p_to date, p_kinds text[], p_sources text[], p_targets text[]
)
returns setof public.transactions
language sql
stable
security invoker
set search_path = ''
as $$
  select tx.*
  from public.transactions tx
  where tx.id in (
    select e.txn_id
    from private.money_flow_edges(p_from, p_to) e
    join unnest(p_kinds, p_sources, p_targets) as w(kind, source, target)
      on w.kind = e.kind and w.source = e.source and w.target = e.target
  )
  order by tx.posted_on desc, tx.id;
$$;

revoke all on function private.money_flow_edges(date, date) from public, anon;
revoke all on function public.money_flow_transactions(date, date, text[], text[], text[]) from public, anon;
grant execute on function private.money_flow_edges(date, date) to authenticated;
grant execute on function public.money_flow_transactions(date, date, text[], text[], text[]) to authenticated;

-- Dragged node positions, per person: { node key: { x, y } } as fractions of
-- the diagram's width and height, so they survive resizing.
alter table public.user_preferences
  add column sankey_positions jsonb
    check (sankey_positions is null or jsonb_typeof(sankey_positions) = 'object'),
  add check (sankey_positions is null or pg_column_size(sankey_positions) < 20000);
