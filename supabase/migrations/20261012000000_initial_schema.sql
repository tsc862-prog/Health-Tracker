-- Already applied to the Weight Journey project on 2026-10-12. Kept here as
-- the record of the schema. Combines the first three migrations:
-- create_weight_journey_schema, add_presets, add_macros_to_meals_and_presets.

create table public.user_settings (
  user_id        uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  unit           text not null default 'lb' check (unit in ('lb', 'kg')),
  goal_weight_kg numeric(6, 2) check (goal_weight_kg is null or goal_weight_kg > 0),
  updated_at     timestamptz not null default now()
);

create table public.weigh_ins (
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  date       date not null,
  kg         numeric(6, 2) not null check (kg > 0),
  note       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table public.meals (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  date        date not null,
  type        text not null default 'Snack',
  description text not null,
  calories    integer check (calories is null or calories >= 0),
  protein_g   integer check (protein_g is null or protein_g >= 0),
  carbs_g     integer check (carbs_g   is null or carbs_g   >= 0),
  fat_g       integer check (fat_g     is null or fat_g     >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index meals_user_date_idx on public.meals (user_id, date);

create table public.exercise (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  date       date not null,
  activity   text not null,
  minutes    integer not null check (minutes >= 0),
  calories   integer check (calories is null or calories >= 0),
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exercise_user_date_idx on public.exercise (user_id, date);

create table public.meal_presets (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name       text not null,
  type       text not null default '',
  calories   integer check (calories is null or calories >= 0),
  protein_g  integer check (protein_g is null or protein_g >= 0),
  carbs_g    integer check (carbs_g   is null or carbs_g   >= 0),
  fat_g      integer check (fat_g     is null or fat_g     >= 0),
  updated_at timestamptz not null default now()
);
create index meal_presets_user_idx on public.meal_presets (user_id);

create table public.exercise_presets (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name       text not null,
  minutes    integer check (minutes is null or minutes >= 0),
  calories   integer check (calories is null or calories >= 0),
  updated_at timestamptz not null default now()
);
create index exercise_presets_user_idx on public.exercise_presets (user_id);

alter table public.user_settings    enable row level security;
alter table public.weigh_ins        enable row level security;
alter table public.meals            enable row level security;
alter table public.exercise         enable row level security;
alter table public.meal_presets     enable row level security;
alter table public.exercise_presets enable row level security;

create policy "own settings"         on public.user_settings    for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own weigh_ins"        on public.weigh_ins        for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own meals"            on public.meals            for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own exercise"         on public.exercise         for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own meal_presets"     on public.meal_presets     for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own exercise_presets" on public.exercise_presets for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
