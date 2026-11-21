begin;

-- Only deductions made with the minus button qualify, including those from older app versions.
create view grocery_private.my_stock_uses with (security_barrier = true) as
select a.transaction_id, a.product_id, a.actor_name, a.prev_quantity - a.new_quantity as amount,
  case when r.result #>> '{product,pieces_per_pack}' is not null then 'pc/s'
       else r.result #>> '{product,unit}' end as stock_unit
from public.activity_logs a
join grocery_private.mutation_receipts r on r.transaction_id = a.transaction_id and r.actor_id = a.user_id
where a.user_id = (select auth.uid()) and (select grocery_private.family_role()) in ('ADMIN', 'MEMBER')
  and a.action = 'QUANTITY_DECREASED' and a.prev_quantity > a.new_quantity
  and r.request ->> 'operation' = 'adjust_quantity' and r.request #>> '{payload,quest_intent}' = 'usage';
revoke all on grocery_private.my_stock_uses from public, anon, authenticated;
grant select on grocery_private.my_stock_uses to authenticated;

-- Keep the snapshot under the caller's existing read policies. The extra detail lets another
-- phone identify an eligible deduction without rewriting the original activity or receipt.
create or replace function public.grocery_snapshot()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select case when public.grocery_sync_ready() then jsonb_build_object(
    'products', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.products p),
    'shopping', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.shopping_list s),
    'activity', (select coalesce(jsonb_agg(case when u.stock_unit is null then to_jsonb(a)
        else jsonb_set(to_jsonb(a), '{metadata_json}', a.metadata_json || jsonb_build_object('usageUnit', u.stock_unit)) end), '[]'::jsonb)
      from public.activity_logs a left join grocery_private.my_stock_uses u on u.transaction_id = a.transaction_id)
  ) end;
$$;

create unique index grocery_one_return_per_use on public.activity_logs ((metadata_json ->> 'originalTransactionId'))
  where action = 'STOCK_RETURNED';

create function public.return_grocery_usage(p_transaction_id text, p_product_id text, p_original_transaction_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  request jsonb := jsonb_build_object('operation', 'return_usage', 'id', p_product_id, 'original', p_original_transaction_id);
  receipt grocery_private.mutation_receipts%rowtype;
  original grocery_private.my_stock_uses%rowtype;
  product public.products%rowtype;
  previous numeric;
  result jsonb;
begin
  if actor is null or coalesce(grocery_private.family_role(), '') not in ('ADMIN', 'MEMBER') then
    raise exception 'Family account required' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_transaction_id)), 0) not between 1 and 200
     or coalesce(length(btrim(p_original_transaction_id)), 0) not between 1 and 200
     or coalesce(length(btrim(p_product_id)), 0) not between 1 and 200 then
    raise exception 'A product and both transaction IDs are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('grocery:' || p_transaction_id, 0));
  select * into receipt from grocery_private.mutation_receipts where transaction_id = p_transaction_id;
  if found then
    if receipt.actor_id <> actor or receipt.request <> request then
      raise exception 'Transaction ID already used' using errcode = '23505';
    end if;
    return receipt.result;
  end if;

  select * into original from grocery_private.my_stock_uses
    where transaction_id = p_original_transaction_id and product_id = p_product_id;
  if not found then
    raise exception 'Choose one of your own stock uses for this product' using errcode = '42501';
  end if;
  select * into product from public.products where id = p_product_id and is_active for update;
  if not found then raise exception 'Active product not found' using errcode = 'P0002'; end if;
  if original.stock_unit is distinct from (case when product.pieces_per_pack is null then product.unit else 'pc/s' end) then
    raise exception 'The stock unit changed after this use' using errcode = '23514';
  end if;
  if exists (select 1 from public.activity_logs where action = 'STOCK_RETURNED'
       and metadata_json ->> 'originalTransactionId' = p_original_transaction_id) then
    raise exception 'This use was already returned' using errcode = '23505';
  end if;

  previous := product.quantity;
  update public.products set quantity = quantity + original.amount, version = version + 1,
    last_modified_by = actor, updated_at = now() where id = p_product_id returning * into product;
  insert into public.activity_logs(transaction_id, product_id, user_id, actor_name, action, prev_quantity, new_quantity, metadata_json)
    values (p_transaction_id, p_product_id, actor, original.actor_name, 'STOCK_RETURNED', previous, product.quantity,
      jsonb_build_object('originalTransactionId', p_original_transaction_id, 'productName', product.name));
  if exists (select 1 from grocery_private.quest_ledger where source_key = 'inventory:' || p_original_transaction_id) then
    perform public.pantry_quest_mark_correction(p_original_transaction_id, 'Product returned to stock');
  end if;
  result := jsonb_build_object('product', to_jsonb(product));
  insert into grocery_private.mutation_receipts(transaction_id, actor_id, request, result)
    values (p_transaction_id, actor, request, result);
  return result;
end;
$$;
revoke all on function public.return_grocery_usage(text, text, text) from public, anon, authenticated;
grant execute on function public.return_grocery_usage(text, text, text) to authenticated;
notify pgrst, 'reload schema';
commit;
