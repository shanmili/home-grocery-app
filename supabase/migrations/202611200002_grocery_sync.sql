begin;
create table grocery_private.sync_initialized (ready boolean primary key check (ready));

alter table grocery_private.sync_initialized enable row level security;

create function public.grocery_sync_ready()
returns boolean language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce(grocery_private.family_role(), '') not in ('ADMIN', 'MEMBER') then
    raise exception 'Family account required' using errcode = '42501';
  end if;
  return exists(select 1 from grocery_private.sync_initialized);
end;
$$;

create function public.initialize_grocery_sync(p_products jsonb, p_shopping jsonb)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  item jsonb;
begin
  if grocery_private.family_role() is distinct from 'ADMIN' then
    raise exception 'Admin role required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('grocery-bootstrap', 0));
  if exists(select 1 from grocery_private.sync_initialized) then return false; end if;
  if exists(select 1 from public.products) or exists(select 1 from public.shopping_list)
     or exists(select 1 from public.activity_logs) then
    raise exception 'Shared inventory already contains data; contact the project owner' using errcode = '55000';
  end if;

  for item in select value from jsonb_array_elements(p_products) loop
    perform public.apply_grocery_change('initial-product:' || (item ->> 'id'),
      'create_product', item ->> 'id', item);
  end loop;
  for item in select value from jsonb_array_elements(p_shopping) loop
    perform public.apply_grocery_change('initial-shopping:' || (item ->> 'id'),
      'add_shopping_item', item ->> 'id', item);
  end loop;

  insert into grocery_private.sync_initialized values (true);
  return true;
end;
$$;

-- A single read uses one consistent database snapshot and applies the existing read policies.
create function public.grocery_snapshot()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select case when public.grocery_sync_ready() then jsonb_build_object(
    'products', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.products p),
    'shopping', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.shopping_list s),
    'activity', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.activity_logs a)
  ) end;
$$;

revoke all on function public.grocery_sync_ready(), public.initialize_grocery_sync(jsonb, jsonb),
  public.grocery_snapshot() from public, anon, authenticated;
grant execute on function public.grocery_sync_ready(), public.initialize_grocery_sync(jsonb, jsonb),
  public.grocery_snapshot() to authenticated;

-- An automatic low-stock entry is derived on each device. Confirm it against the
-- product version so two devices cannot mark the same stock state as purchased.
create function public.confirm_grocery_restock(
  p_transaction_id text, p_product_id text, p_quantity numeric, p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  product public.products%rowtype;
  item_id text := 'restock:' || p_transaction_id;
  payload jsonb := jsonb_build_object('quantity', p_quantity, 'expected_version', p_expected_version, 'product_id', p_product_id);
begin
  if grocery_private.family_role() is distinct from 'ADMIN' then
    raise exception 'Admin role required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('grocery:' || p_transaction_id, 0));
  if exists(select 1 from grocery_private.mutation_receipts where transaction_id = p_transaction_id) then
    return public.apply_grocery_change(p_transaction_id, 'confirm_purchase', item_id, payload);
  end if;
  select * into product from public.products where id = p_product_id and is_active for update;
  if not found or product.version is distinct from p_expected_version then
    raise exception 'Stock changed before the purchase could sync' using errcode = '40001';
  end if;
  insert into public.shopping_list(id, product_id, label, requested_quantity, unit)
  values (item_id, product.id, product.name, p_quantity, product.unit);
  return public.apply_grocery_change(p_transaction_id, 'confirm_purchase', item_id, payload);
end;
$$;
revoke all on function public.confirm_grocery_restock(text, text, numeric, bigint) from public, anon, authenticated;
grant execute on function public.confirm_grocery_restock(text, text, numeric, bigint) to authenticated;


notify pgrst, 'reload schema';
commit;
