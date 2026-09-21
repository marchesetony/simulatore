-- Production runtime persistence for Vercel + Supabase.
-- Apply this migration through the provider migration pipeline, never at app startup.

create table if not exists public.runtime_records (
  collection text not null,
  tenant_id text not null,
  record_id text not null,
  schema_version integer not null,
  version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  payload jsonb not null,
  idempotency_key text null,
  primary key (collection, tenant_id, record_id),
  check (schema_version > 0),
  check (version > 0),
  check (tenant_id = '__unscoped__' or tenant_id ~ '^tenant_[a-z0-9-]+$')
);

create unique index if not exists runtime_records_idempotency_idx
  on public.runtime_records (collection, tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists runtime_records_tenant_collection_idx
  on public.runtime_records (tenant_id, collection, record_id);

create table if not exists public.runtime_users (
  user_id text primary key check (user_id ~ '^user_[a-z0-9-]+$'),
  display_name text not null,
  created_at timestamptz not null default now(),
  active boolean not null default true
);

create table if not exists public.runtime_memberships (
  user_id text not null references public.runtime_users(user_id),
  tenant_id text not null check (tenant_id ~ '^tenant_[a-z0-9-]+$'),
  role text not null check (role in ('ADMIN', 'ANALYST', 'VIEWER')),
  status text not null check (status in ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create table if not exists public.runtime_sessions (
  session_id text primary key check (session_id ~ '^session_[a-z0-9-]+$'),
  session_hash text not null unique,
  user_id text not null references public.runtime_users(user_id),
  tenant_id text not null check (tenant_id ~ '^tenant_[a-z0-9-]+$'),
  role text not null check (role in ('ADMIN', 'ANALYST', 'VIEWER')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  check (expires_at > issued_at)
);

create index if not exists runtime_sessions_active_hash_idx
  on public.runtime_sessions (session_hash, expires_at)
  where revoked_at is null;

alter table public.runtime_records enable row level security;
alter table public.runtime_users enable row level security;
alter table public.runtime_memberships enable row level security;
alter table public.runtime_sessions enable row level security;

create or replace function public.runtime_put_record(
  p_collection text,
  p_tenant_id text,
  p_record_id text,
  p_payload jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null,
  p_now timestamptz default now(),
  p_append_only boolean default false
) returns setof public.runtime_records
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.runtime_records;
  now_value timestamptz := coalesce(p_now, now());
begin
  if p_tenant_id <> '__unscoped__' and p_tenant_id !~ '^tenant_[a-z0-9-]+$' then
    raise exception 'PERSISTENCE_TENANT_INVALID';
  end if;
  select * into current_row
    from public.runtime_records
   where collection = p_collection and tenant_id = p_tenant_id and record_id = p_record_id
   for update;

  if current_row.record_id is not null then
    if p_idempotency_key is not null and current_row.idempotency_key = p_idempotency_key then
      return next current_row;
      return;
    end if;
    if p_append_only then raise exception 'PERSISTENCE_APPEND_ONLY_CONFLICT'; end if;
    if p_expected_version is null or current_row.version <> p_expected_version then
      raise exception 'PERSISTENCE_VERSION_CONFLICT';
    end if;
    update public.runtime_records
       set schema_version = 1, version = current_row.version + 1, updated_at = now_value,
           payload = p_payload, idempotency_key = p_idempotency_key
     where collection = p_collection and tenant_id = p_tenant_id and record_id = p_record_id
     returning * into current_row;
    return next current_row;
    return;
  end if;

  if p_expected_version is not null then raise exception 'PERSISTENCE_VERSION_CONFLICT'; end if;
  insert into public.runtime_records(collection, tenant_id, record_id, schema_version, version, created_at, updated_at, payload, idempotency_key)
  values (p_collection, p_tenant_id, p_record_id, 1, 1, now_value, now_value, p_payload, p_idempotency_key)
  returning * into current_row;
  return next current_row;
end;
$$;

create or replace function public.runtime_delete_record(
  p_collection text,
  p_tenant_id text,
  p_record_id text,
  p_expected_version integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare current_version integer;
begin
  select version into current_version from public.runtime_records
   where collection = p_collection and tenant_id = p_tenant_id and record_id = p_record_id for update;
  if current_version is null then return; end if;
  if p_expected_version is null or current_version <> p_expected_version then
    raise exception 'PERSISTENCE_VERSION_CONFLICT';
  end if;
  delete from public.runtime_records where collection = p_collection and tenant_id = p_tenant_id and record_id = p_record_id;
end;
$$;

revoke all on function public.runtime_put_record(text, text, text, jsonb, integer, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.runtime_delete_record(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.runtime_put_record(text, text, text, jsonb, integer, text, timestamptz, boolean) to service_role;
grant execute on function public.runtime_delete_record(text, text, text, integer) to service_role;

insert into storage.buckets (id, name, public)
values ('bill-documents', 'bill-documents', false)
on conflict (id) do update set public = false;
