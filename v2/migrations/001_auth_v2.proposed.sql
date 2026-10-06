-- PROPOSAL ONLY. Never executed by the application. No V1 data migration.
-- Prerequisites: the two referenced V1 migrations providing runtime_users,
-- runtime_identities and runtime_memberships. Review/apply separately.
begin;

create table public.v2_auth_tenants (
  tenant_id text primary key check (tenant_id ~ '^tenant_[a-z0-9-]+$'),
  active boolean not null default false
);

-- A TENANT assignment IS the V2 membership; PLATFORM assignments have no tenant.
create table public.v2_auth_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.runtime_users(user_id),
  scope text not null check (scope in ('PLATFORM', 'TENANT')),
  tenant_id text references public.v2_auth_tenants(tenant_id),
  role text not null check (role in ('PLATFORM_OWNER', 'TENANT_ADMIN', 'SALES_MANAGER', 'SALES_OPERATOR')),
  status text not null default 'SUSPENDED' check (status in ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  permissions text[] not null default '{}',
  check (array_position(permissions, null) is null),
  check (permissions <@ array['auth:login', 'auth:session']::text[]),
  check ((scope = 'PLATFORM' and role = 'PLATFORM_OWNER' and tenant_id is null)
    or (scope = 'TENANT' and role in ('TENANT_ADMIN', 'SALES_MANAGER', 'SALES_OPERATOR') and tenant_id is not null))
);
create unique index v2_auth_platform_assignment on public.v2_auth_assignments(user_id) where scope = 'PLATFORM';
create unique index v2_auth_tenant_membership on public.v2_auth_assignments(user_id, tenant_id) where scope = 'TENANT';

create table public.v2_auth_sessions (
  session_id uuid primary key,
  session_hash text not null unique check (session_hash ~ '^[a-f0-9]{64}$'),
  auth_user_id uuid not null references public.runtime_identities(auth_user_id),
  user_id text not null references public.runtime_users(user_id),
  assignment_id uuid not null references public.v2_auth_assignments(id),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '1 day')
);

alter table public.v2_auth_tenants enable row level security;
alter table public.v2_auth_assignments enable row level security;
alter table public.v2_auth_sessions enable row level security;
revoke all on public.v2_auth_tenants, public.v2_auth_assignments, public.v2_auth_sessions from public, anon, authenticated;
grant select on public.v2_auth_tenants, public.v2_auth_assignments to service_role;
grant select, insert, update on public.v2_auth_sessions to service_role;

-- No seed, default user, permission grant, legacy conversion, or tenant invented.
commit;
