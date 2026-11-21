-- Run with psql on a migrated test database with two configured accounts.
-- Supply admin_id and member_id with -v. All test writes are rolled back.
\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('test.member_id', :'member_id', true);
do $$
declare
  admin_id text := auth.uid()::text;
  product_id text := gen_random_uuid()::text;
  use_id text := gen_random_uuid()::text;
  return_id text := gen_random_uuid()::text;
  xp_before numeric;
  points_before numeric;
  result jsonb;
begin
  if not public.grocery_sync_ready() then perform public.initialize_grocery_sync('[]', '[]'); end if;
  perform public.apply_grocery_change(gen_random_uuid()::text, 'create_product', product_id,
    jsonb_build_object('name', product_id, 'category', 'Test', 'unit', 'pack', 'pieces_per_pack', 22, 'quantity', 2));
  perform set_config('request.jwt.claim.sub', current_setting('test.member_id'), true);
  select (p->>'totalXp')::numeric, (p->>'rewardPoints')::numeric into xp_before, points_before
    from public.pantry_quest_profile() p;
  perform public.apply_grocery_change(use_id, 'adjust_quantity', product_id, '{"delta":-1,"quest_intent":"usage"}');
  assert exists (select 1 from grocery_private.my_stock_uses where transaction_id = use_id and amount = 1 and stock_unit = 'pc/s');

  perform set_config('request.jwt.claim.sub', admin_id, true);
  begin
    perform public.return_grocery_usage(gen_random_uuid()::text, product_id, use_id);
    raise exception 'Another account returned the use';
  exception when insufficient_privilege then null;
  end;
  perform public.apply_grocery_change(gen_random_uuid()::text, 'adjust_quantity', product_id, '{"delta":3}');
  perform set_config('request.jwt.claim.sub', current_setting('test.member_id'), true);
  begin
    perform public.apply_grocery_change(gen_random_uuid()::text, 'adjust_quantity', product_id, '{"delta":1}');
    raise exception 'Member added unrelated stock';
  exception when insufficient_privilege then null;
  end;
  result := public.return_grocery_usage(return_id, product_id, use_id);
  assert (result #>> '{product,quantity}')::numeric = 5;
  assert public.return_grocery_usage(return_id, product_id, use_id) = result;
  begin
    perform public.return_grocery_usage(gen_random_uuid()::text, product_id, use_id);
    raise exception 'The same deduction was returned twice';
  exception when unique_violation then null;
  end;
  assert (select quantity = 5 from public.products where id = product_id);
  assert (select count(*) = 1 from public.activity_logs where transaction_id = return_id and action = 'STOCK_RETURNED');
  result := public.pantry_quest_profile();
  assert (result->>'totalXp')::numeric = xp_before and (result->>'rewardPoints')::numeric = points_before;
end;
$$;
rollback;
