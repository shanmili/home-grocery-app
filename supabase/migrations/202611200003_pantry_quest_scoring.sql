begin;

create table grocery_private.quest_scoring_rules (
  action text primary key,
  xp integer not null check (xp >= 0),
  reward_points integer not null check (reward_points >= 0)
);
insert into grocery_private.quest_scoring_rules values
  ('STOCK_USED', 2, 1), ('OUT_OF_STOCK_REPORTED', 5, 1),
  ('SHOPPING_ITEM_ADDED', 3, 1), ('RESTOCK_NEED_CONFIRMED', 3, 1),
  ('STOCK_RESTOCKED', 10, 1), ('WEEKLY_CHALLENGE_COMPLETED', 15, 1);

create table grocery_private.quest_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null references grocery_private.quest_scoring_rules(action),
  source_key text not null unique,
  xp integer not null,
  reward_points integer not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null,
  reverses_id bigint unique references grocery_private.quest_ledger(id),
  reason text,
  check (
    (reverses_id is null and xp >= 0 and reward_points >= 0)
    or (reverses_id is not null and xp <= 0 and reward_points <= 0
        and reason is not null and length(btrim(reason)) between 1 and 250)
  )
);
create index quest_ledger_actor_time on grocery_private.quest_ledger(user_id, recorded_at desc, id desc);
alter table grocery_private.quest_scoring_rules enable row level security;
alter table grocery_private.quest_ledger enable row level security;
revoke all on grocery_private.quest_scoring_rules, grocery_private.quest_ledger from public, anon, authenticated;

-- Receipts are created only after a successful inventory change and its activity record.
create function grocery_private.score_inventory_receipt()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  entry public.activity_logs%rowtype;
  scored_action text;
begin
  if not exists (select 1 from grocery_private.sync_initialized) then return new; end if;

  select * into entry from public.activity_logs where transaction_id = new.transaction_id;
  if not found or entry.user_id <> new.actor_id then return new; end if;

  case
    when entry.action = 'QUANTITY_DECREASED'
      and new.request ->> 'operation' = 'adjust_quantity'
      and new.request #>> '{payload,quest_intent}' = 'usage'
      and entry.prev_quantity > entry.new_quantity then
      scored_action := 'STOCK_USED';
    when entry.action = 'SHOPPING_ITEM_ADDED'
      and new.request ->> 'operation' = 'add_shopping_item'
      and entry.product_id is null then
      scored_action := 'SHOPPING_ITEM_ADDED';
    when entry.action = 'SHOPPING_MARKED_PURCHASED'
      and new.request ->> 'operation' = 'confirm_purchase'
      and entry.product_id is not null and entry.new_quantity > entry.prev_quantity then
      scored_action := 'STOCK_RESTOCKED';
    else
      return new;
  end case;

  insert into grocery_private.quest_ledger (user_id, action, source_key, xp, reward_points, recorded_by)
  select new.actor_id, r.action, 'inventory:' || new.transaction_id, r.xp, r.reward_points, new.actor_id
  from grocery_private.quest_scoring_rules r where r.action = scored_action
  on conflict (source_key) do nothing;
  return new;
end;
$$;
revoke all on function grocery_private.score_inventory_receipt() from public, anon, authenticated;
create trigger quest_score_inventory_receipt
after insert on grocery_private.mutation_receipts
for each row execute function grocery_private.score_inventory_receipt();

create function public.pantry_quest_mark_correction(p_transaction_id text, p_reason text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  original grocery_private.quest_ledger%rowtype;
begin
  if coalesce(grocery_private.family_role(), '') not in ('ADMIN', 'MEMBER') then
    raise exception 'Family account required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 250 then
    raise exception 'Enter a correction reason' using errcode = '22023';
  end if;
  select * into original from grocery_private.quest_ledger
    where source_key = 'inventory:' || p_transaction_id and reverses_id is null;
  if not found or (original.user_id <> caller and grocery_private.family_role() <> 'ADMIN') then
    raise exception 'Award not available for correction' using errcode = '42501';
  end if;
  insert into grocery_private.quest_ledger
    (user_id, action, source_key, xp, reward_points, recorded_by, reverses_id, reason)
  values (original.user_id, original.action, 'reversal:' || original.id,
    -original.xp, -original.reward_points, caller, original.id, btrim(p_reason))
  on conflict (reverses_id) do nothing;
  return found;
end;
$$;

create function public.pantry_quest_profile()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  result jsonb;
begin
  if coalesce(grocery_private.family_role(), '') not in ('ADMIN', 'MEMBER') then
    raise exception 'Family account required' using errcode = '42501';
  end if;
  with user_entries as (
    select * from grocery_private.quest_ledger where user_id = caller
  ), qualifying as (
    select e.* from user_entries e where e.reverses_id is null
    and not exists (select 1 from user_entries r where r.reverses_id = e.id)
  ), scoring_days as (
    select distinct (recorded_at at time zone 'Asia/Manila')::date as day
    from qualifying where xp > 0
  ), days_in_order as (
    select day, row_number() over (order by day desc) as day_rank from scoring_days
  ), streak as (
    select count(*) as day_count from days_in_order
    where (select max(day) from scoring_days) >= (now() at time zone 'Asia/Manila')::date - 1
      and day = (select max(day) from scoring_days) - (day_rank::integer - 1)
  )
  select jsonb_build_object(
    'userId', caller,
    'totalXp', (select coalesce(sum(xp), 0) from user_entries),
    'rewardPoints', (select coalesce(sum(reward_points), 0) from user_entries),
    'streak', (select day_count from streak),
    'contributions', (select count(*) from qualifying),
    'contributionsByAction', (select coalesce(jsonb_object_agg(action, count), '{}'::jsonb)
      from (select action, count(*) from qualifying group by action) counts),
    'recentLedger', (select coalesce(jsonb_agg(to_jsonb(e) order by e.recorded_at desc, e.id desc), '[]'::jsonb)
      from (select * from user_entries order by recorded_at desc, id desc limit 30) e),
    'rules', (select jsonb_object_agg(action, jsonb_build_object('xp', xp, 'rewardPoints', reward_points))
      from grocery_private.quest_scoring_rules)
  ) into result;
  return result;
end;
$$;

revoke all on function public.pantry_quest_profile(), public.pantry_quest_mark_correction(text, text)
  from public, anon, authenticated;
grant execute on function public.pantry_quest_profile(), public.pantry_quest_mark_correction(text, text)
  to authenticated;
notify pgrst, 'reload schema';
commit;
