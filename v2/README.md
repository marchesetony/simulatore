# Login / Auth V2 — review locale

Solo login email/password e verifica sessione. Nessuna dashboard o funzionalità di dominio.
Nessun deploy, modifica remota, migrazione applicata o conversione di record V1.

## Flusso e confini

`/v2/login` → `POST /api/v2/auth/login` → service → provider / access repository / session repository.

1. API: origine esatta configurata, JSON limitato a 4096 byte, solo email/password.
2. Provider: password grant Supabase Auth seguito da verifica `/auth/v1/user`.
3. Identity: `runtime_identities.auth_user_id` → `runtime_users.user_id`, utente attivo.
4. Access: assegnazioni V2 persistite; ruolo, scope, identity, stato e permission verificati.
5. TENANT: membership ACTIVE e tenant attivo; PLATFORM: nessun tenant artificiale.
6. Sessione: token casuale di 256 bit; solo SHA-256 nel database; rilettura dopo insert.
7. Cookie `__Host-v2-auth`, HttpOnly, Secure, SameSite=Strict, Path=/, scadenza esplicita.
8. `GET /api/v2/auth/session`: verifica hash, scadenza/revoca, identity attiva e accessi correnti.

Il JSON pubblico contiene solo `authenticated` ed eventualmente un messaggio sicuro.
Token Supabase e refresh token non sono persistiti né restituiti al browser.
Il token opaco applicativo è restituito esclusivamente nel cookie HttpOnly.
La UI conferma la sessione e mostra “Accesso effettuato”, senza redirect ad altre funzionalità.
Nessun accesso V1 viene autorizzato automaticamente dalla sessione V2.

## Ruoli e permission

| Input | Risultato V2 |
|---|---|
| PLATFORM_OWNER | PLATFORM_OWNER, scope PLATFORM, tenant assente |
| TENANT_ADMIN | TENANT_ADMIN, scope TENANT, membership ACTIVE |
| SALES_MANAGER | SALES_MANAGER, scope TENANT, membership ACTIVE |
| SALES_OPERATOR | SALES_OPERATOR, scope TENANT, membership ACTIVE |
| PRODUCT_OWNER / ADMIN / ANALYST / VIEWER | LEGACY_ROLE_REQUIRES_REVIEW, nessuna conversione |
| Qualsiasi altro ruolo | ACCESS_CONFIGURATION_INVALID |

`LEGACY_ROLE_REQUIRES_REVIEW` è un errore interno tipizzato; il risultato login è
`ACCESS_CONFIGURATION_INVALID`, reso come messaggio amministrativo generico dalla API.
Gli altri risultati sono AUTHENTICATED, AUTHENTICATION_FAILED,
AUTHENTICATION_UNAVAILABLE e TENANT_SELECTION_REQUIRED.

Le sole permission del mattoncino sono `auth:login` e `auth:session`.
Entrambe devono essere assegnate esplicitamente per creare una sessione.
Nessuna permission è derivata dal nome del ruolo; array assente, invalido o vuoto non concede accesso.
`authorizedSession` è l'ingresso server per autorizzare: riceve un token, non claim del browser.
Un target tenant è un selettore non autorevole: viene verificato nel repository e confrontato
con il tenant del principal; per PLATFORM deve esistere ed essere attivo.
Queste permission non autorizzano future operazioni di amministrazione o business.

Più assegnazioni attive restituiscono TENANT_SELECTION_REQUIRED senza creare sessioni.
La selezione tenant è fuori da questa UI minimale; nessuna scelta implicita della prima riga.
In assenza di assegnazioni V2, i ruoli V1 vengono letti solo per segnalare la review necessaria.
Le occorrenze legacy PRODUCT_OWNER restano in `app/lib/foundation/types.ts:9` e
`app/api/foundation/authorization/route.ts:19`; non sono state modificate.

## Configurazione esclusivamente server

Unico punto di lettura dell'ambiente: `core/config/auth.ts`.
Variabili obbligatorie, nessun valore di default e nessun prefisso NEXT_PUBLIC:

| Variabile | Vincolo |
|---|---|
| V2_SUPABASE_URL | Origine HTTPS Supabase, senza path, userinfo, query o fragment |
| V2_SUPABASE_PUBLISHABLE_KEY | Chiave publishable moderna `sb_publishable_…` |
| V2_SUPABASE_SECRET_KEY | Chiave server moderna `sb_secret_…`, mai nel client |
| V2_AUTH_ORIGIN | Origine HTTPS esatta dell'applicazione |
| V2_AUTH_SESSION_SECONDS | Intero esplicito tra 60 e 86400 |

Configurazione validata a ogni richiesta auth; se assente, 503 sicuro, senza chiamate provider.
Il build e il rendering del form non richiedono credenziali. Il login richiede HTTPS anche localmente.
Le chiavi JWT legacy anon/service_role non sono accettate implicitamente.
I moduli server hanno il guard `server-only`; la UI importa solo React e CSS.

## Proposta database (non applicata)

`migrations/001_auth_v2.proposed.sql` propone tre tabelle, senza seed o migrazioni V1:

- `v2_auth_tenants`: solo identificativo e stato per verificare il confine tenant.
- `v2_auth_assignments`: assegnazione PLATFORM oppure membership TENANT, ruolo canonico,
  stato e permission esplicite; default sospeso, permission vuote.
- `v2_auth_sessions`: hash del token, identity, utente, assegnazione, scadenza e revoca.

RLS abilitata, nessuna policy client; privilegi rimossi da public/anon/authenticated.
Il runtime service_role ha solo lettura sugli accessi e select/insert/update sulle sessioni.
Non ci sono RPC né SECURITY DEFINER. Provisioning futuro esplicito a cura del database owner.
Le FK richiedono le tabelle V1: non sono replicate in questa proposta.
Il file deve essere revisionato e validato su PostgreSQL isolato prima di qualsiasi applicazione.
Non è una dichiarazione dello schema remoto attualmente presente.

Riferimenti V1 letti con git show, senza checkout/merge/cherry-pick:
`origin/feature/production-auth-supabase-v1`, migrazioni 20260821000000 e 20260824122637,
e `app/lib/production/supabase.ts`. Nessun monolite copiato.

## Verifica riproducibile

Eseguito con Node 25.3.0 e dipendenze del lockfile esistente, senza nuove dipendenze:

```sh
node --experimental-transform-types --import ./v2/tests/register.mjs --test v2/tests/*.test.mjs
npx tsc --noEmit
npm run lint
npx eslint v2 app/v2 app/api/v2 --max-warnings 0
npm run build
```

Il loader è limitato al test runner: risolve import TS e sostituisce il guard server-only
fuori da Next. Il build reale mantiene il guard. I test non usano credenziali o servizi remoti.
Copertura: successo, password errata, outage, identity/membership/tenant mancanti,
sessione non creabile, mancata rilettura, scadenza/revoca, config assente, secret isolation,
quattro ruoli canonici, quattro legacy, tenant mismatch, permission mancante,
claim client aggiuntivi, CSRF, body invalido/eccessivo e adapter HTTP.

## Limiti residui

- Accesso remoto non collaudato e SQL non eseguito: occorrono schema revisionato,
  provisioning esplicito e configurazione reale prima dell'attivazione.
- Nessun refresh, rinnovo automatico o gestione UI delle sessioni: scadenza fissa,
  revoca server tramite revoked_at e rilettura di identity/membership a ogni verifica.
- Dopo il login l'autorità della sessione è applicativa: disabilitare solo l'account Auth
  non sostituisce revoca delle sessioni V2/disattivazione di runtime_users.
- Rate limiting del provider rispettato (429 → indisponibilità); nessun rate limiter
  distribuito applicativo aggiunto in questa fase.
- Verifica grafica non eseguita: browser collegato assente e permessi Computer Use mancanti.
  Rendering e risposte API sono verificati via HTTP e test automatici.

Documentazione consultata: [Next Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers),
guide locali Next 16.2.4, [Supabase Auth API](https://github.com/supabase/auth/blob/master/openapi.yaml),
[chiavi Supabase](https://supabase.com/docs/guides/getting-started/api-keys),
[verifica utente](https://supabase.com/docs/reference/javascript/auth-getuser).
