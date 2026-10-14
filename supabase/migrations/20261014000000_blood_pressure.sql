-- Blood pressure readings: several per day, each with a time of day.
-- Run this in the Supabase SQL editor (or `supabase db push`) if the table
-- does not exist yet. The app keeps readings on-device until it does.

create table if not exists public.blood_pressure (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  date       date not null,
  time       text not null default '12:00' check (time ~ '^\d{2}:\d{2}$'),
  systolic   integer not null check (systolic between 40 and 300),
  diastolic  integer not null check (diastolic between 20 and 200),
  pulse      integer check (pulse is null or pulse between 20 and 300),
  note       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists blood_pressure_user_date_idx on public.blood_pressure (user_id, date);

alter table public.blood_pressure enable row level security;

drop policy if exists "own blood_pressure" on public.blood_pressure;
create policy "own blood_pressure" on public.blood_pressure
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
