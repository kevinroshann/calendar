create table if not exists public.calendar_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{"events":[],"goals":[],"items":[],"challenges":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.calendar_data enable row level security;

grant select, insert, update on public.calendar_data to authenticated;

drop policy if exists "Users can access their own calendar data" on public.calendar_data;

create policy "Users can access their own calendar data"
  on public.calendar_data
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
