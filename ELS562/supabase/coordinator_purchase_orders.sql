begin;

create table if not exists public.coordinator_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  coordinator_user_id uuid not null,
  token text not null unique check (length(token) >= 32),
  document jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, coordinator_user_id),
  check (document->>'kind' is not distinct from 'coordinator'),
  check (document->>'coordinatorUserId' is not distinct from coordinator_user_id::text),
  check (document->>'token' is not distinct from token)
);
create table if not exists public.coordinator_purchase_order_shows (
  purchase_order_id uuid not null,
  coordinator_user_id uuid not null,
  show_id uuid not null references public.shows(id),
  primary key (purchase_order_id, show_id),
  unique (coordinator_user_id, show_id),
  foreign key (purchase_order_id, coordinator_user_id)
    references public.coordinator_purchase_orders(id, coordinator_user_id) on delete cascade
);
create index if not exists coordinator_purchase_order_review_idx on public.coordinator_purchase_orders ((document->>'status'), id);
create index if not exists coordinator_purchase_order_year_idx on public.coordinator_purchase_orders ((document->>'year'), created_at desc);
alter table public.coordinator_purchase_orders enable row level security;
alter table public.coordinator_purchase_order_shows enable row level security;
revoke all on public.coordinator_purchase_orders from anon, authenticated;
revoke all on public.coordinator_purchase_order_shows from anon, authenticated;
grant all on public.coordinator_purchase_orders to service_role;
grant all on public.coordinator_purchase_order_shows to service_role;

-- Claim every show in the same transaction as the document. The unique
-- coordinator/show key prevents two concurrent drafts from billing it twice.
create or replace function public.create_coordinator_purchase_order(
  p_coordinator uuid, p_token text, p_document jsonb, p_created_by uuid, p_show_ids uuid[]
) returns public.coordinator_purchase_orders
language plpgsql security invoker set search_path = public
as $$
declare
  saved public.coordinator_purchase_orders;
  line_count integer;
  line_total numeric;
begin
  if coalesce(cardinality(p_show_ids), 0) < 1 or cardinality(p_show_ids) > 25
    or cardinality(p_show_ids) <> (select count(distinct value) from unnest(p_show_ids) as value)
    or array_position(p_show_ids, null) is not null then
    raise exception 'Select between 1 and 25 distinct shows';
  end if;
  if p_document->>'status' is distinct from 'ready' or jsonb_typeof(p_document->'showLines') is distinct from 'array' then
    raise exception 'Invalid coordinator purchase order';
  end if;
  select count(*), round(sum((line->>'amount')::numeric), 2)
    into line_count, line_total from jsonb_array_elements(p_document->'showLines') as line;
  if line_count <> cardinality(p_show_ids) or line_total <= 0
    or line_total is distinct from round((p_document->>'total')::numeric, 2)
    or exists (select 1 from jsonb_array_elements(p_document->'showLines') as line
      where line->>'amount' is null or not ((line->>'showId')::uuid = any(p_show_ids)) or (line->>'amount')::numeric <= 0)
    or (select count(distinct line->>'showId') from jsonb_array_elements(p_document->'showLines') as line) <> cardinality(p_show_ids) then
    raise exception 'Purchase order lines do not match selected shows and total';
  end if;
  insert into public.coordinator_purchase_orders(coordinator_user_id, token, document, created_by)
    values(p_coordinator, p_token, p_document, p_created_by) returning * into saved;
  insert into public.coordinator_purchase_order_shows(purchase_order_id, coordinator_user_id, show_id)
    select saved.id, p_coordinator, value from unnest(p_show_ids) as value;
  return saved;
end;
$$;
revoke all on function public.create_coordinator_purchase_order(uuid,text,jsonb,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.create_coordinator_purchase_order(uuid,text,jsonb,uuid,uuid[]) to service_role;
notify pgrst, 'reload schema';
commit;
