-- "Same as" for merchants (docs/DESIGN.md: Recurring charges): the household
-- says a merchant name is another name for an existing merchant (e.g. a
-- service billed under a new name), so its charges are treated as one.

create table public.merchant_aliases (
  household_id uuid not null references public.households (id) on delete cascade,
  -- merchantKey() of the name being merged, and of the merchant it is the same as.
  merchant_key text not null check (length(merchant_key) between 1 and 200),
  same_as      text not null check (length(same_as) between 1 and 200),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (household_id, merchant_key),
  check (merchant_key <> same_as)
);

alter table public.merchant_aliases enable row level security;
create policy "members manage household merchant aliases"
  on public.merchant_aliases for all to authenticated
  using (private.is_member(household_id))
  with check (private.is_member(household_id));
revoke all on public.merchant_aliases from anon, authenticated;
grant select, insert, update, delete on public.merchant_aliases to authenticated;
