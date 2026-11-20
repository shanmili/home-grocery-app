begin;

create table grocery_private.quest_redemptions (
  user_id uuid not null,
  request_id text not null check (length(btrim(request_id)) between 1 and 100),
  points_spent bigint not null check (points_spent > 0 and points_spent % 10000 = 0),
  pesos bigint generated always as (points_spent / 10000) stored,
  redeemed_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table grocery_private.quest_redemptions enable row level security;
revoke all on grocery_private.quest_redemptions from public, anon, authenticated;

create function grocery_private.lock_quest_balance()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('quest-balance:' || new.user_id::text, 0));
  return new;
end;
$$;
revoke all on function grocery_private.lock_quest_balance() from public, anon, authenticated;
create trigger quest_balance_write_lock before insert on grocery_private.quest_ledger
for each row execute function grocery_private.lock_quest_balance();

create function public.pantry_quest_redeem_points(p_request_id text, p_pesos integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  claim grocery_private.quest_redemptions%rowtype;
  cost bigint;
  balance bigint;
begin
  if caller is null or coalesce(grocery_private.family_role(), '') not in ('ADMIN', 'MEMBER') then
    raise exception 'Family account required' using errcode = '42501';
  end if;
  if p_pesos is null or p_pesos <= 0 or p_request_id is null
     or length(btrim(p_request_id)) not between 1 and 100 then
    raise exception 'Invalid claim' using errcode = '22023';
  end if;
  cost := p_pesos::bigint * 10000;
  perform pg_advisory_xact_lock(hashtextextended('quest-balance:' || caller::text, 0));

  select * into claim from grocery_private.quest_redemptions
    where user_id = caller and request_id = p_request_id;
  if found then
    if claim.points_spent <> cost then
      raise exception 'This request ID was used for a different amount' using errcode = '23505';
    end if;
    return to_jsonb(claim);
  end if;

  select coalesce(sum(reward_points), 0) -
    (select coalesce(sum(points_spent), 0) from grocery_private.quest_redemptions where user_id = caller)
    into balance from grocery_private.quest_ledger where user_id = caller;
  if balance < cost then
    raise exception 'There are not enough confirmed reward points for this claim' using errcode = '23514';
  end if;

  insert into grocery_private.quest_redemptions(user_id, request_id, points_spent)
    values (caller, p_request_id, cost) returning * into claim;
  return to_jsonb(claim);
end;
$$;

create function public.pantry_quest_rewards_profile()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  profile jsonb := public.pantry_quest_progression_profile();
begin
  return profile || jsonb_build_object(
    'rewardPoints', (profile ->> 'rewardPoints')::bigint - (
      select coalesce(sum(points_spent), 0) from grocery_private.quest_redemptions where user_id = caller
    ),
    'redemptions', (
      select coalesce(jsonb_agg(jsonb_build_object('id', request_id, 'points', points_spent,
        'pesos', pesos, 'redeemedAt', redeemed_at) order by redeemed_at desc, request_id), '[]'::jsonb)
      from grocery_private.quest_redemptions where user_id = caller
    )
  );
end;
$$;

revoke all on function public.pantry_quest_redeem_points(text, integer), public.pantry_quest_rewards_profile()
  from public, anon, authenticated;
grant execute on function public.pantry_quest_redeem_points(text, integer), public.pantry_quest_rewards_profile()
  to authenticated;
notify pgrst, 'reload schema';
commit;
