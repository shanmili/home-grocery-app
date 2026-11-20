begin;

create schema grocery_private;
revoke all on schema grocery_private from public, anon, authenticated;
grant usage on schema grocery_private to authenticated;

-- Read the current server-managed role each time, including after reassignment.
create function grocery_private.family_role()
returns text
language sql stable security definer set search_path = ''
as $$
  select raw_app_meta_data ->> 'grocery_role'
  from auth.users
  where id = auth.uid() and email_confirmed_at is not null;
$$;
revoke all on function grocery_private.family_role() from public, anon, authenticated;
grant execute on function grocery_private.family_role() to authenticated;

create table public.products (
  id text primary key check (length(btrim(id)) between 1 and 200),
  name text not null check (length(btrim(name)) between 1 and 200),
  category text not null check (length(btrim(category)) between 1 and 100),
  quantity numeric not null default 0 check (quantity >= 0 and quantity < 'Infinity'::numeric),
  unit text not null check (length(btrim(unit)) between 1 and 100),
  min_threshold numeric not null default 0 check (min_threshold >= 0 and min_threshold < 'Infinity'::numeric),
  expiration_date date,
  is_active boolean not null default true,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_modified_by uuid not null
);

create table public.shopping_list (
  id text primary key check (length(btrim(id)) between 1 and 200),
  product_id text references public.products(id),
  label text not null check (length(btrim(label)) between 1 and 200),
  requested_quantity numeric not null check (requested_quantity >= 0 and requested_quantity < 'Infinity'::numeric),
  unit text not null check (length(btrim(unit)) between 1 and 100),
  is_purchased boolean not null default false,
  purchased_quantity numeric check (purchased_quantity > 0 and purchased_quantity < 'Infinity'::numeric),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_open_shopping_item_per_product
  on public.shopping_list(product_id) where not is_purchased and product_id is not null;

create table public.activity_logs (
  id bigint generated always as identity primary key,
  transaction_id text not null unique,
  product_id text references public.products(id),
  user_id uuid not null,
  actor_name text not null,
  action text not null,
  prev_quantity numeric,
  new_quantity numeric,
  metadata_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index activity_logs_user_time on public.activity_logs(user_id, occurred_at desc);

create table grocery_private.mutation_receipts (
  transaction_id text primary key,
  actor_id uuid not null,
  request jsonb not null,
  result jsonb not null
);

alter table grocery_private.mutation_receipts enable row level security;

alter table public.products enable row level security;
alter table public.shopping_list enable row level security;
alter table public.activity_logs enable row level security;
revoke all on public.products, public.shopping_list, public.activity_logs from public, anon, authenticated;
grant select on public.products, public.shopping_list, public.activity_logs to authenticated;

create policy family_reads_products on public.products for select to authenticated
using ((select grocery_private.family_role()) = 'ADMIN'
    or (is_active and (select grocery_private.family_role()) = 'MEMBER'));

create policy family_reads_shopping on public.shopping_list for select to authenticated
using ((select grocery_private.family_role()) = 'ADMIN'
    or (not is_purchased and (select grocery_private.family_role()) = 'MEMBER'
        and (product_id is null or exists (
          select 1 from public.products p where p.id = product_id and p.is_active
        ))));

create policy family_reads_activity on public.activity_logs for select to authenticated
using ((select grocery_private.family_role()) = 'ADMIN'
    or ((select grocery_private.family_role()) = 'MEMBER' and user_id = (select auth.uid())));

-- Mobile clients send an operation and an ID, never an actor or an absolute stock change.
create function public.apply_grocery_change(
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
      insert into public.products(id, name, category, quantity, unit, min_threshold, expiration_date, last_modified_by)
      values (p_entity_id, btrim(p_payload ->> 'name'), btrim(p_payload ->> 'category'),
        coalesce((p_payload ->> 'quantity')::numeric, 0), btrim(p_payload ->> 'unit'),
        coalesce((p_payload ->> 'min_threshold')::numeric, 0),
        (p_payload ->> 'expiration_date')::date, actor)
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

revoke all on function public.apply_grocery_change(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_grocery_change(text, text, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
