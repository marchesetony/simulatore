import { OFFICIAL_DATA_SERVICE_PRINCIPAL, OFFICIAL_DATA_SERVICE_ROLE } from "../../../app/lib/regulatory-approval-domain";

/**
 * Tony (21/11/2026, "Automazione dati ufficiali — servizio Vercel indipendente", punto 6): the service acts with one dedicated
 * technical identity, never with a fictitious ADMIN and never with a user's login. It can only read the official sources and
 * publish verified official data; what it may write is fixed in store.ts (WRITABLE_COLLECTIONS).
 */
export const SERVICE_IDENTITY = {
  principalId: OFFICIAL_DATA_SERVICE_PRINCIPAL,
  role: OFFICIAL_DATA_SERVICE_ROLE,
  name: "Servizio dati ufficiali (automatico)",
  capabilities: ["OFFICIAL_SOURCES_READ", "OFFICIAL_DATA_PUBLISH_VERIFIED"],
} as const;

/** The value written as actor/reviewer on PUN versions and on every record the service writes. */
export const SERVICE_ACTOR = SERVICE_IDENTITY.principalId;
