# Production adapters

Production uses one provider family:

- Supabase Postgres stores tenant-scoped runtime records, users, memberships, sessions and audit events.
- Supabase Auth verifies production email/password credentials; the application never uses the Supabase JWT as its principal.
- `runtime_identities` maps the verified Supabase Auth UUID to the application-owned `runtime_users.user_id`.
- Supabase Storage stores PDF bytes in a private bucket; document metadata is stored in Postgres.
- Server sessions are opaque, hashed bearer tokens stored in Postgres and returned only through an HttpOnly, Secure cookie.

Required protected production environment:

```text
APP_RUNTIME_MODE=production
FOUNDATION_LOCAL_DEV=false
AUTH_ADAPTER=server-session
PERSISTENCE_ADAPTER=provider
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_<key>
SUPABASE_PUBLISHABLE_KEY=sb_publishable_<key>
SUPABASE_STORAGE_BUCKET=bill-documents
```

`SUPABASE_SECRET_KEY` is a server-only `sb_secret_...` key for provider persistence and the manual admin bootstrap. `SUPABASE_PUBLISHABLE_KEY` is the low-privilege key used by the server-side Supabase Auth client for email/password verification. Neither key is copied into the application cookie or returned to the browser; the legacy service-role environment variable is not part of this contract.

Optional safe defaults:

```text
PRODUCTION_SESSION_COOKIE_NAME=__Host-simulatore_session
PRODUCTION_SESSION_MAX_AGE_SECONDS=28800
```

Apply `supabase/migrations/20260821000000_production_runtime.sql` through the provider migration pipeline before enabling production. The application does not run migrations at startup and never copies local `var/` data into the provider.

Apply `supabase/migrations/20260824122637_runtime_identities.sql` through the provider migration pipeline before enabling production login. This PASS only adds the migration file; it does not apply it remotely.

Production routes:

- `POST /api/auth/login` verifies email/password with Supabase Auth, resolves the server-side identity and active membership, then issues the opaque application cookie.
- `POST /api/auth/logout` revokes the application session and clears the cookie idempotently.
- `GET /api/auth/session` returns only safe authentication context.
- `/login` is the production login page.

The initial administrator is created only by the manual `npm run production:bootstrap-admin` command. It requires `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_DISPLAY_NAME`, and `BOOTSTRAP_ADMIN_TENANT_ID`; it never creates a session automatically.
