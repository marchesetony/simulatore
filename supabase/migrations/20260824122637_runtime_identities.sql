-- Maps Supabase Auth identities to the application-owned runtime user.
-- Access remains server-side through the service_role client; no client policy is needed.

create table if not exists public.runtime_identities (
  auth_user_id uuid primary key,
  user_id text not null references public.runtime_users(user_id),
  provider text not null check (provider = 'supabase'),
  created_at timestamptz not null default now()
);

create index if not exists runtime_identities_user_id_idx
  on public.runtime_identities (user_id);

alter table public.runtime_identities enable row level security;

revoke all on public.runtime_identities from public, anon, authenticated;
grant all on public.runtime_identities to service_role;
