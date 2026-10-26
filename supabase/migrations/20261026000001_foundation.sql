-- Phase 1 foundation: households, members, accounts, import-file archive bucket.
--
-- Security model (see docs/DESIGN.md §5):
--   * Every row belongs to a household. A user may read/write a row only if they
--     are a member of that household (enforced by RLS via private.is_member).
--   * Households and memberships are created only through SECURITY DEFINER RPCs,
--     never by direct INSERT from the client.
--   * The `anon` role has no table privileges at all.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Households and members
-- ---------------------------------------------------------------------------

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'member');

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.member_role not null default 'member',
  display_name text not null check (length(btrim(display_name)) between 1 and 50),
  -- Relative weight for splitting shared expenses: a member's share is
  -- split_weight / sum(split_weight) over the household. Equal weights = 50/50.
  split_weight numeric(7, 3) not null default 1 check (split_weight > 0),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- v1 simplification: a user belongs to at most one household.
create unique index household_members_one_household_per_user
  on public.household_members (user_id);

-- Membership test used by every RLS policy. SECURITY DEFINER so that the
-- household_members policy can call it without recursing into itself.
create function private.is_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = p_household_id
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_member(uuid) from public;
grant execute on function private.is_member(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy "members read their household"
  on public.households for select to authenticated
  using (private.is_member(id));

create policy "members rename their household"
  on public.households for update to authenticated
  using (private.is_member(id))
  with check (private.is_member(id));

create policy "members read co-members"
  on public.household_members for select to authenticated
  using (private.is_member(household_id));

create policy "members edit co-member display name and split weight"
  on public.household_members for update to authenticated
  using (private.is_member(household_id))
  with check (private.is_member(household_id));

revoke all on public.households, public.household_members from anon, authenticated;
grant select on public.households, public.household_members to authenticated;
grant update (name) on public.households to authenticated;
grant update (display_name, split_weight) on public.household_members to authenticated;

-- Creates a household with the caller as owner. Returns the household id.
create function public.create_household(p_name text, p_display_name text)
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
  return v_id;
end;
$$;

-- Adds an existing auth user (created in the Supabase dashboard, since public
-- sign-up is disabled) to the caller's household. Owner only.
create function public.add_household_member(p_email text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_household uuid;
  v_new_user  uuid;
begin
  select household_id into v_household
  from public.household_members
  where user_id = v_uid and role = 'owner';

  if v_household is null then
    raise exception 'only a household owner can add members' using errcode = '42501';
  end if;

  select id into v_new_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_new_user is null then
    raise exception 'no user with that email; create the user in the Supabase dashboard first'
      using errcode = 'P0002';
  end if;
  if exists (select 1 from public.household_members where user_id = v_new_user) then
    raise exception 'that user already belongs to a household' using errcode = '23505';
  end if;

  insert into public.household_members (household_id, user_id, role, display_name)
    values (v_household, v_new_user, 'member', p_display_name);
  return v_new_user;
end;
$$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.add_household_member(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.add_household_member(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create type public.account_type as enum (
  'checking', 'savings', 'credit_card', 'mortgage', 'auto_loan', 'other_loan', 'other'
);

create table public.accounts (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 100),
  institution   text check (institution is null or length(institution) <= 100),
  type          public.account_type not null,
  is_liability  boolean generated always as
                  (type in ('credit_card', 'mortgage', 'auto_loan', 'other_loan')) stored,
  -- NULL = joint. When set, must be a member of the same household.
  owner_user_id uuid,
  last4         text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  is_archived   boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (household_id, owner_user_id)
    references public.household_members (household_id, user_id)
    on delete set null (owner_user_id)
);

create index accounts_household_idx on public.accounts (household_id);

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger accounts_touch_updated_at
  before update on public.accounts
  for each row execute function private.touch_updated_at();

alter table public.accounts enable row level security;

create policy "members manage household accounts"
  on public.accounts for all to authenticated
  using (private.is_member(household_id))
  with check (private.is_member(household_id));

revoke all on public.accounts from anon, authenticated;
grant select, insert, update, delete on public.accounts to authenticated;

-- ---------------------------------------------------------------------------
-- Import-file archive (Storage)
--
-- Original CSV exports are stored unmodified at
--   imports/{household_id}/{account_id}/{yyyy-mm-dd}_{sha256-prefix}.csv
-- The archive is append-only from the client: no update or delete policies.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

create function private.can_access_import_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.user_id = (select auth.uid())
      and m.household_id::text = (storage.foldername(p_name))[1]
  );
$$;

revoke all on function private.can_access_import_object(text) from public;
grant execute on function private.can_access_import_object(text) to authenticated;

create policy "members read household import files"
  on storage.objects for select to authenticated
  using (bucket_id = 'imports' and private.can_access_import_object(name));

create policy "members upload household import files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'imports' and private.can_access_import_object(name));
