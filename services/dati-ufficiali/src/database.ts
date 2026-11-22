import postgres from "postgres";
import type { TenantRecord } from "../../../app/lib/persistence/types";
import type { RecordBackend } from "./store";

/**
 * Tony (21/11/2026, Fase B): the service connects to Supabase only as the dedicated database role svc_dati_ufficiali (no Supabase
 * key, no administrative privilege). The role can execute only the functions of schema servizio_dati, which check collection,
 * company, append-only, version and PUN rules; the RLS policies on runtime_records are the second, independent barrier.
 * The password comes only from the protected environment and is never logged, returned or put into the connection URL.
 */
export interface ServiceDatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  /** PEM of the Supabase root certificate: TLS is always verified for remote hosts. */
  readonly ca: string | null;
}

export interface ServiceDatabaseEnvironment {
  readonly SERVIZIO_DATI_DB_URL?: string;
  readonly SERVIZIO_DATI_DB_PASSWORD?: string;
  readonly SERVIZIO_DATI_DB_CA?: string;
}

const fail = (code: string): never => { throw new Error(code); };
const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const SERVICE_USER = /^svc_dati_ufficiali(\.[a-z0-9]{20})?$/;
const REMOTE_HOST = /^(?:[a-z0-9-]+\.pooler\.supabase\.com|db\.[a-z0-9]{20}\.supabase\.co)$/;

/** Reads and checks the configuration: wrong user, password inside the URL, unknown host or missing certificate are refused. */
export function serviceDatabaseConfig(env: ServiceDatabaseEnvironment): ServiceDatabaseConfig {
  let url: URL;
  try { url = new URL(env.SERVIZIO_DATI_DB_URL ?? ""); } catch { return fail("SERVICE_DB_URL_INVALID"); }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") fail("SERVICE_DB_URL_INVALID");
  if (url.password) fail("SERVICE_DB_PASSWORD_IN_URL");
  const user = decodeURIComponent(url.username);
  if (!SERVICE_USER.test(user)) fail("SERVICE_DB_USER_NOT_SERVICE_ROLE");
  const host = url.hostname.toLowerCase();
  const local = LOCAL.has(host);
  if (!local && !REMOTE_HOST.test(host)) fail("SERVICE_DB_HOST_NOT_ALLOWED");
  const password = env.SERVIZIO_DATI_DB_PASSWORD ?? "";
  if (password.length < 24) fail("SERVICE_DB_PASSWORD_MISSING");
  const ca = (env.SERVIZIO_DATI_DB_CA ?? "").replace(/\\n/g, "\n").trim();
  if (!local && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(ca)) fail("SERVICE_DB_CA_MISSING");
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
  return { host, port: Number(url.port || 5432), database, user, password, ca: local ? null : ca };
}

type Row = { collection: string; tenant_id: string; record_id: string; schema_version: number; version: number; created_at: Date | string; updated_at: Date | string; payload: unknown; idempotency_key: string | null };
const toRecord = (row: Row): TenantRecord<unknown> => {
  if (row.schema_version !== 1 || !Number.isSafeInteger(row.version) || row.version < 1 || row.payload === undefined) fail("SERVICE_DATA_INVALID");
  return { schemaVersion: 1, recordId: row.record_id, tenantId: row.tenant_id, version: row.version, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), payload: structuredClone(row.payload), ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}) } as TenantRecord<unknown>;
};
/** Only the code raised by the database functions travels upwards, never connection details. */
const databaseError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : "";
  const code = /^(SERVIZIO_[A-Z_]+|PERSISTENCE_[A-Z_]+)/.exec(message)?.[1];
  if (code) return new Error(code);
  const sqlState = (error as { code?: unknown })?.code;
  return new Error(typeof sqlState === "string" && /^[0-9A-Z]{5}$/.test(sqlState) ? `SERVICE_DB_ERROR_${sqlState}` : "SERVICE_DB_UNAVAILABLE");
};

export type ServiceDatabaseBackend = RecordBackend & { close(): Promise<void> };

/**
 * RecordBackend on the servizio_dati functions. The client companies are read through servizio_dati.aziende_clienti(), which
 * returns only tenant identifiers: the service never opens the companies collection.
 */
export function postgresBackend(config: ServiceDatabaseConfig): ServiceDatabaseBackend {
  const sql = postgres({
    host: config.host, port: config.port, database: config.database, username: config.user, password: config.password,
    ssl: config.ca ? { ca: config.ca, rejectUnauthorized: true, servername: config.host } : false,
    max: 2, idle_timeout: 20, connect_timeout: 15, max_lifetime: 300,
    prepare: false, // Supabase transaction pooler: no named prepared statements
    onnotice: () => undefined,
    connection: { application_name: "servizio-dati-ufficiali" },
  });
  const run = async (query: () => Promise<readonly Row[]>): Promise<readonly Row[]> => {
    try { return await query(); } catch (error) { throw databaseError(error); }
  };
  return {
    async get(collection, tenantId, recordId) {
      const rows = await run(() => sql<Row[]>`select * from servizio_dati.leggi(${collection}, ${tenantId}, ${recordId})`);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async list(collection, tenantId) {
      if (collection === "companies") {
        if (tenantId !== "tenant_piattaforma") return [];
        let tenants: readonly { t: string }[];
        try { tenants = await sql<{ t: string }[]>`select t from servizio_dati.aziende_clienti() t`; } catch (error) { throw databaseError(error); }
        const at = new Date(0).toISOString();
        return tenants.map(({ t }) => ({ schemaVersion: 1, recordId: `azienda-${t}`, tenantId, version: 1, createdAt: at, updatedAt: at, payload: { tenantId: t } }) as TenantRecord<unknown>);
      }
      return (await run(() => sql<Row[]>`select * from servizio_dati.elenca(${collection}, ${tenantId})`)).map(toRecord);
    },
    async write(collection, record, appendOnly) {
      const rows = await run(() => sql<Row[]>`select * from servizio_dati.scrivi(${collection}, ${record.tenantId}, ${record.recordId}, ${JSON.stringify(record.payload)}::text::jsonb, ${record.expectedVersion ?? null}::integer, ${record.idempotencyKey ?? null}::text, ${record.now ?? null}::timestamptz, ${appendOnly}::boolean)`);
      if (!rows[0]) fail("SERVICE_PERSISTENCE_EMPTY_RESULT");
      return toRecord(rows[0]);
    },
    async close() { await sql.end({ timeout: 5 }); },
  };
}
