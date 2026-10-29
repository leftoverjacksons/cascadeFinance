-- Recurring charges (docs/DESIGN.md: Recurring charges). Detection runs in the
-- app from the household's transactions; this table only remembers the
-- merchants the household said are not recurring, so they stay hidden.

create table public.recurring_dismissals (
  household_id uuid not null references public.households (id) on delete cascade,
  -- merchantKey() of the merchant's description (src/domain/flows.ts).
  merchant_key text not null check (length(merchant_key) between 1 and 200),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (household_id, merchant_key)
);

alter table public.recurring_dismissals enable row level security;
create policy "members manage household recurring dismissals"
  on public.recurring_dismissals for all to authenticated
  using (private.is_member(household_id))
  with check (private.is_member(household_id));
revoke all on public.recurring_dismissals from anon, authenticated;
grant select, insert, delete on public.recurring_dismissals to authenticated;
