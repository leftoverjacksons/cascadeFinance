-- Delete a category, or a group with its categories (docs/DESIGN.md:
-- Categorisation). Their transactions become uncategorised, then the
-- household's remaining rules get a chance to categorise them again; rules
-- that set a deleted category are removed. Transfer categories cannot be
-- deleted (transfer linking assigns them): archive or rename those instead.
-- Returns the number of transactions that were in the deleted categories.

create function public.delete_category(p_category uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.categories;
  v_ids uuid[];
  v_txns uuid[];
begin
  select * into v_category from public.categories where id = p_category;
  if v_category.id is null or not private.is_member(v_category.household_id) then
    raise exception 'category not found' using errcode = '42501';
  end if;
  if v_category.kind = 'transfer' then
    raise exception 'transfer categories are used to link transfers and cannot be deleted; archive or rename it instead'
      using errcode = '22023';
  end if;

  select array_agg(id) into v_ids
  from public.categories
  where id = p_category or parent_id = p_category;

  select coalesce(array_agg(id), '{}') into v_txns
  from public.transactions
  where household_id = v_category.household_id and category_id = any (v_ids);

  -- Unassign first, so the rule triggers below cannot assign them again.
  update public.transactions
  set category_id = null, category_source = 'none'
  where id = any (v_txns);
  delete from public.category_rules where set_category_id = any (v_ids);
  delete from public.categories where parent_id = p_category;
  delete from public.categories where id = p_category;

  -- What the remaining rules make of them.
  perform private.categorise(v_category.household_id, v_txns);
  return coalesce(array_length(v_txns, 1), 0);
end;
$$;

revoke all on function public.delete_category(uuid) from public, anon;
grant execute on function public.delete_category(uuid) to authenticated;
