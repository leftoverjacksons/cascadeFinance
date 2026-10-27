-- Per-person preferences (e.g. the desktop dashboard layout).
-- Unlike household data, each row is private to its user: partners in the
-- same household can arrange their own dashboards independently.

create table public.user_preferences (
  user_id          uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  dashboard_layout jsonb check (dashboard_layout is null or jsonb_typeof(dashboard_layout) = 'object'),
  updated_at       timestamptz not null default now(),
  -- Layouts are small; this bounds abuse of the column.
  check (dashboard_layout is null or pg_column_size(dashboard_layout) < 20000)
);

create trigger user_preferences_touch_updated_at
  before update on public.user_preferences
  for each row execute function private.touch_updated_at();

alter table public.user_preferences enable row level security;

create policy "users manage their own preferences"
  on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.user_preferences from anon, authenticated;
grant select, insert, update, delete on public.user_preferences to authenticated;
