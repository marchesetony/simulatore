-- PROPOSAL ONLY; not applied. Requires reviewed V2 AUTH schema.
-- No V1 data copied, no permission assignments changed, no seed data.
begin;
create table public.v2_customers (
  id uuid primary key,
  tenant_id text not null references public.v2_auth_tenants(tenant_id),
  name text not null check (length(btrim(name)) between 1 and 160),
  tax_code text check (tax_code ~* '^[A-Z0-9 .-]{5,32}$'),
  vat_number text check (vat_number ~* '^[A-Z0-9 .-]{5,32}$')
);
create index v2_customers_tenant_list on public.v2_customers(tenant_id, name, id);
alter table public.v2_customers enable row level security;
revoke all on public.v2_customers from public, anon, authenticated, service_role;
grant select, insert on public.v2_customers to service_role;
grant update(name, tax_code, vat_number) on public.v2_customers to service_role;
-- No public policies: only server service_role; application enforces verified
-- session + canonical-role policy + active tenant, and tenant-filtered queries.
-- Ownership/id cannot be updated by service_role; no DELETE/TRUNCATE grant.
commit;
