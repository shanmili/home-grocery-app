begin;

create table grocery_private.quest_levels (
  level integer primary key check (level > 0),
  title text not null check (length(btrim(title)) between 1 and 100),
  minimum_xp integer not null unique check (minimum_xp >= 0)
);
insert into grocery_private.quest_levels values
  (1, 'Pantry Starter', 0), (2, 'Household Helper', 25),
  (3, 'Pantry Regular', 75), (4, 'Stock Guardian', 150),
  (5, 'Pantry Champion', 300);

create table grocery_private.quest_achievements (
  id text primary key,
  title text not null check (length(btrim(title)) between 1 and 100),
  metric text not null check (metric in ('xp', 'contributions', 'streak',
    'STOCK_USED', 'SHOPPING_ITEM_ADDED', 'STOCK_RESTOCKED')),
  target integer not null check (target > 0),
  display_order integer not null unique
);
insert into grocery_private.quest_achievements values
  ('first-step', 'First Step', 'contributions', 1, 1),
  ('consistent-helper', 'Consistent Helper', 'streak', 3, 2),
  ('shopping-buddy', 'Shopping Buddy', 'SHOPPING_ITEM_ADDED', 3, 3),
  ('stock-master', 'Stock Master', 'STOCK_RESTOCKED', 3, 4),
  ('family-mvp', 'Family MVP', 'xp', 150, 5);

alter table grocery_private.quest_levels enable row level security;
alter table grocery_private.quest_achievements enable row level security;
revoke all on grocery_private.quest_levels, grocery_private.quest_achievements from public, anon, authenticated;

-- Badge metrics use confirmed, unreversed contributions from the existing profile.
create function public.pantry_quest_progression_profile()
returns jsonb language sql stable security definer set search_path = ''
as $$
  with profile as materialized (
    select public.pantry_quest_profile() as value
  ), totals as (
    select value, (value ->> 'totalXp')::bigint as xp from profile
  ), scoring_days as (
    select distinct (e.recorded_at at time zone 'Asia/Manila')::date as day
    from grocery_private.quest_ledger e
    where e.user_id = auth.uid() and e.reverses_id is null and e.xp > 0
      and not exists (select 1 from grocery_private.quest_ledger r where r.reverses_id = e.id)
  ), streak_runs as (
    select day - (row_number() over (order by day))::integer as run
    from scoring_days
  ), best_streak as (
    select count(*) as days from streak_runs group by run order by days desc limit 1
  ), level_now as (
    select l.* from grocery_private.quest_levels l, totals t
    where l.minimum_xp <= t.xp order by l.minimum_xp desc limit 1
  ), level_next as (
    select l.* from grocery_private.quest_levels l, totals t
    where l.minimum_xp > t.xp order by l.minimum_xp limit 1
  ), badges as (
    select a.*,
      case a.metric
        when 'xp' then t.xp
        when 'contributions' then (t.value ->> 'contributions')::bigint
        when 'streak' then coalesce((select days from best_streak), 0)
        else coalesce((t.value -> 'contributionsByAction' ->> a.metric)::bigint, 0)
      end as progress
    from grocery_private.quest_achievements a cross join totals t
  )
  select value || jsonb_build_object(
    'level', (select jsonb_build_object('number', level, 'title', title, 'minimumXp', minimum_xp) from level_now),
    'nextLevel', (select jsonb_build_object('number', level, 'title', title, 'minimumXp', minimum_xp) from level_next),
    'achievements', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'title', title, 'metric', metric, 'target', target,
      'progress', least(progress, target), 'earned', progress >= target
    ) order by display_order), '[]'::jsonb) from badges)
  ) from totals;
$$;

revoke all on function public.pantry_quest_progression_profile() from public, anon, authenticated;
grant execute on function public.pantry_quest_progression_profile() to authenticated;
notify pgrst, 'reload schema';
commit;
