-- Overdraft fees: USAA labels "OD FEE - ITEM PAID - ACH - FORD MOTOR CR ..."
-- as "Auto Payment", so the bank-category mapping filed them as loan payments
-- (a transfer, excluded from spending). They are bank fees.
--
-- Priority 400: ahead of the seeded transfer rules (500) and bank-category
-- mappings (1000), behind anything the household writes (default 100).

create function private.seed_rules_v2(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.category_rules
             where household_id = p_household and upper(btrim(pattern)) = 'OD FEE') then
    return;
  end if;
  insert into public.category_rules (household_id, priority, field, match_type, pattern, set_category_id)
  select p_household, 400, 'description', 'contains', 'OD FEE', c.id
  from public.categories c
  join public.categories g on g.id = c.parent_id
  where c.household_id = p_household and g.name = 'Financial' and c.name = 'Fees & Charges'
  limit 1;
end;
$$;

revoke all on function private.seed_rules_v2(uuid) from public;

-- New households get it too.
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
  perform private.seed_rules_v2(v_id);
  return v_id;
end;
$$;

-- Existing households (the rule's insert trigger re-categorises them).
do $$
declare
  h uuid;
begin
  for h in select id from public.households loop
    perform private.seed_rules_v2(h);
  end loop;
end;
$$;
