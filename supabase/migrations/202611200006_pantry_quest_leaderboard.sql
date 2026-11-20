begin;

create function public.pantry_quest_leaderboard()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  week_start timestamptz := date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
  standings jsonb;
begin
  if coalesce(grocery_private.family_role(), '') not in ('ADMIN', 'MEMBER') then
    raise exception 'Family account required' using errcode = '42501';
  end if;

  with family as (
    select id, coalesce(nullif(btrim(raw_app_meta_data ->> 'grocery_name'), ''), 'Family member') as name
    from auth.users
    where email_confirmed_at is not null and raw_app_meta_data ->> 'grocery_role' in ('ADMIN', 'MEMBER')
  ), qualifying as (
    select e.user_id, e.action, e.xp, e.recorded_at
    from grocery_private.quest_ledger e join family f on f.id = e.user_id
    where e.reverses_id is null
      and not exists (select 1 from grocery_private.quest_ledger r where r.reverses_id = e.id)
  ), totals as (
    select q.user_id, sum(q.xp) as xp, count(*) as contributions,
      coalesce(sum(q.xp) filter (where q.recorded_at >= week_start), 0) as weekly_xp,
      count(*) filter (where q.action = 'SHOPPING_ITEM_ADDED') as shopping_added,
      count(*) filter (where q.action = 'STOCK_RESTOCKED') as restocks,
      count(*) filter (where q.action = 'STOCK_USED') as usage
    from qualifying q group by q.user_id
  ), days as (
    select distinct user_id, (recorded_at at time zone 'Asia/Manila')::date as day
    from qualifying where xp > 0
  ), streak_runs as (
    select user_id, day - row_number() over (partition by user_id order by day)::integer as run
    from days
  ), streaks as (
    select user_id, max(days) as best
    from (select user_id, count(*) as days from streak_runs group by user_id, run) counts
    group by user_id
  ), ranked as (
    select f.id, f.name, coalesce(t.weekly_xp, 0) as weekly_xp, coalesce(t.contributions, 0) as contributions,
      dense_rank() over (order by coalesce(t.weekly_xp, 0) desc) as place,
      coalesce((
        select jsonb_agg(a.title order by a.display_order)
        from grocery_private.quest_achievements a
        where a.target <= coalesce(case a.metric
          when 'xp' then t.xp
          when 'contributions' then t.contributions
          when 'streak' then s.best
          when 'SHOPPING_ITEM_ADDED' then t.shopping_added
          when 'STOCK_RESTOCKED' then t.restocks
          when 'STOCK_USED' then t.usage
        end, 0)
      ), '[]'::jsonb) as badges
    from family f left join totals t on t.user_id = f.id
    left join streaks s on s.user_id = f.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', name, 'rank', place, 'weeklyXp', weekly_xp,
    'contributions', contributions, 'badges', badges, 'isYou', id = auth.uid()
  ) order by place, lower(name), id), '[]'::jsonb) into standings
  from ranked;
  return standings;
end;
$$;

revoke all on function public.pantry_quest_leaderboard() from public, anon, authenticated;
grant execute on function public.pantry_quest_leaderboard() to authenticated;
notify pgrst, 'reload schema';
commit;
