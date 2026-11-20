begin;

alter table public.products add column pieces_per_pack integer;
alter table public.products add constraint grocery_pack_piece_count check (
  pieces_per_pack is null or (
    unit = 'pack' and pieces_per_pack > 0 and quantity = trunc(quantity)
  )
);

-- Reject new duplicates without blocking installation if historical duplicates exist.
create function grocery_private.reject_duplicate_product()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if not new.is_active then return new; end if;
  if tg_op = 'UPDATE' then
    if old.is_active and lower(btrim(old.name)) = lower(btrim(new.name)) then return new; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('grocery-product-name:' || lower(btrim(new.name)), 0));
  if exists (
    select 1 from public.products p where p.is_active and p.id <> new.id
      and lower(btrim(p.name)) = lower(btrim(new.name))
  ) then
    raise exception 'The product already exists.' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger grocery_reject_duplicate_product
before insert or update of name, is_active on public.products
for each row execute function grocery_private.reject_duplicate_product();

create or replace function public.apply_grocery_change(
  p_transaction_id text, p_operation text, p_entity_id text, p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  actor_role text := grocery_private.family_role();
  actor_name text;
  request jsonb := jsonb_build_object('operation', p_operation, 'id', p_entity_id, 'payload', p_payload);
  receipt grocery_private.mutation_receipts%rowtype;
  product public.products%rowtype;
  item public.shopping_list%rowtype;
  amount numeric;
  previous numeric;
  next_quantity numeric;
  action text;
  result jsonb;
begin
  if actor is null or actor_role is null or actor_role not in ('ADMIN', 'MEMBER') then
    raise exception 'Family account required' using errcode = '42501';
  end if;
  if actor_role = 'MEMBER' and p_operation is distinct from 'adjust_quantity' then
    raise exception 'Admin role required' using errcode = '42501';
  end if;
  if p_transaction_id is null or length(btrim(p_transaction_id)) not between 1 and 200
     or p_entity_id is null or length(btrim(p_entity_id)) not between 1 and 200
     or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  if p_operation = 'adjust_quantity' then
    amount := (p_payload ->> 'delta')::numeric;
    if amount is null or amount = 0 or abs(amount) >= 'Infinity'::numeric then
      raise exception 'A finite nonzero stock change is required' using errcode = '22023';
    end if;
    if actor_role = 'MEMBER' and amount > 0 then
      raise exception 'Members can only decrease stock' using errcode = '42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('grocery:' || p_transaction_id, 0));
  select * into receipt from grocery_private.mutation_receipts where transaction_id = p_transaction_id;
  if found then
    if receipt.actor_id <> actor or receipt.request <> request then
      raise exception 'Transaction ID already used' using errcode = '23505';
    end if;
    return receipt.result;
  end if;

  select coalesce(nullif(btrim(raw_app_meta_data ->> 'grocery_name'), ''), 'Family member')
    into actor_name from auth.users where id = actor;

  case p_operation
    when 'create_product' then
      insert into public.products(id, name, category, quantity, unit, min_threshold, expiration_date, last_modified_by, pieces_per_pack)
      values (p_entity_id, btrim(p_payload ->> 'name'), btrim(p_payload ->> 'category'),
        coalesce((p_payload ->> 'quantity')::numeric, 0), btrim(p_payload ->> 'unit'),
        coalesce((p_payload ->> 'min_threshold')::numeric, 0),
        (p_payload ->> 'expiration_date')::date, actor, (p_payload ->> 'pieces_per_pack')::integer)
      returning * into product;
      next_quantity := product.quantity;
      action := 'PRODUCT_CREATED';
    when 'edit_product', 'archive_product' then
      select * into product from public.products where id = p_entity_id and is_active for update;
      if not found then
        raise exception 'Active product not found' using errcode = 'P0002';
      end if;
      if product.version is distinct from (p_payload ->> 'expected_version')::bigint then
        raise exception 'Product changed since it was loaded' using errcode = '40001';
      end if;
      previous := product.quantity;
      if p_operation = 'edit_product' then
        update public.products set
          name = btrim(p_payload ->> 'name'), category = btrim(p_payload ->> 'category'),
          unit = btrim(p_payload ->> 'unit'), min_threshold = (p_payload ->> 'min_threshold')::numeric,
          pieces_per_pack = case
            when p_payload ? 'pieces_per_pack' then (p_payload ->> 'pieces_per_pack')::integer
            when btrim(p_payload ->> 'unit') = product.unit then product.pieces_per_pack
          end,
          quantity = case when p_payload ? 'pack_conversion_quantity'
            then (p_payload ->> 'pack_conversion_quantity')::numeric else product.quantity end,
          expiration_date = case when p_payload ? 'expiration_date'
            then (p_payload ->> 'expiration_date')::date else product.expiration_date end,
          updated_at = now(), last_modified_by = actor, version = product.version + 1
        where id = p_entity_id returning * into product;
        action := 'PRODUCT_UPDATED';
      else
        update public.products set is_active = false, updated_at = now(),
          last_modified_by = actor, version = product.version + 1
        where id = p_entity_id returning * into product;
        action := 'PRODUCT_ARCHIVED';
      end if;
      next_quantity := product.quantity;
    when 'adjust_quantity' then
      select * into product from public.products where id = p_entity_id and is_active for update;
      if not found then
        raise exception 'Active product not found' using errcode = 'P0002';
      end if;
      previous := product.quantity;
      next_quantity := previous + amount;
      if next_quantity < 0 then
        raise exception 'Insufficient stock' using errcode = '23514';
      end if;
      update public.products set quantity = next_quantity, updated_at = now(),
        last_modified_by = actor, version = product.version + 1
      where id = p_entity_id returning * into product;
      action := case when amount < 0 then 'QUANTITY_DECREASED' else 'QUANTITY_INCREASED' end;
    when 'add_shopping_item' then
      if p_payload ->> 'product_id' is not null then
        select * into product from public.products where id = p_payload ->> 'product_id' and is_active for update;
        if not found then
          raise exception 'Active product not found' using errcode = 'P0002';
        end if;
      end if;
      insert into public.shopping_list(id, product_id, label, requested_quantity, unit)
      values (p_entity_id, product.id, btrim(p_payload ->> 'label'),
        (p_payload ->> 'requested_quantity')::numeric, coalesce(product.unit, btrim(p_payload ->> 'unit')))
      returning * into item;
      action := 'SHOPPING_ITEM_ADDED';
    when 'confirm_purchase' then
      amount := (p_payload ->> 'quantity')::numeric;
      if amount is null or amount <= 0 or amount >= 'Infinity'::numeric then
        raise exception 'A positive purchased quantity is required' using errcode = '22023';
      end if;
      select * into item from public.shopping_list where id = p_entity_id and not is_purchased for update;
      if not found then
        raise exception 'Open shopping item not found' using errcode = 'P0002';
      end if;
      if item.product_id is not null then
        select * into product from public.products where id = item.product_id and is_active for update;
        if not found then
          raise exception 'Active product not found' using errcode = 'P0002';
        end if;
        previous := product.quantity;
        next_quantity := previous + amount;
        update public.products set quantity = next_quantity, updated_at = now(),
          last_modified_by = actor, version = product.version + 1
        where id = item.product_id returning * into product;
      end if;
      update public.shopping_list set is_purchased = true, purchased_quantity = amount,
        updated_at = now() where id = p_entity_id returning * into item;
      action := 'SHOPPING_MARKED_PURCHASED';
    else
      raise exception 'Unsupported grocery operation' using errcode = '22023';
  end case;

  insert into public.activity_logs(transaction_id, product_id, user_id, actor_name, action,
    prev_quantity, new_quantity, metadata_json)
  values (p_transaction_id, product.id, actor, actor_name, action, previous, next_quantity,
    jsonb_strip_nulls(jsonb_build_object('shoppingItemId', item.id, 'label', item.label,
      'purchasedQuantity', item.purchased_quantity, 'productName', product.name)));

  result := (case when product.id is not null then jsonb_build_object('product', to_jsonb(product))
                  else '{}'::jsonb end)
         || (case when item.id is not null then jsonb_build_object('shopping_item', to_jsonb(item))
                  else '{}'::jsonb end);
  insert into grocery_private.mutation_receipts(transaction_id, actor_id, request, result)
    values (p_transaction_id, actor, request, result);
  return result;
end;
$$;

create function public.grocery_pack_units_ready()
returns boolean language sql stable set search_path = ''
as $$ select coalesce(grocery_private.family_role() in ('ADMIN', 'MEMBER'), false); $$;
revoke all on function public.grocery_pack_units_ready() from public, anon, authenticated;
grant execute on function public.grocery_pack_units_ready() to authenticated;

notify pgrst, 'reload schema';
commit;
