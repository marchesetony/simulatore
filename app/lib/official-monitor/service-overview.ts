import type { MarketArchiveRecord, MarketArchiveRepository } from "../market/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { queryApprovedHistoricalMarketData } from "../market/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { operationalMarketMonths, operationalMarketView, romeToday } from "../market/operational-window.ts";
import type { OfficialAlert } from "./monitor";
import type { CoverageReport } from "./coverage";

/**
 * Control Room Produttore → Dati ufficiali (Tony 22/11/2026): GME, ARERA and Terna are checked from the application, never from
 * Vercel logs or a terminal. Read-only: this module only reads the reports the independent official data service writes
 * (collection official-service-runs), the existing alerts, and the PUN archive exactly as the simulation engine reads it
 * (operationalMarketView + queryApprovedHistoricalMarketData, the same calls as app/lib/calculation/engine.ts). It never writes,
 * never computes a value and never changes what the engine uses. Three levels are kept apart:
 * - acquired in test mode (DRY_RUN): downloaded and read by the service, not written into any archive;
 * - validated: every check of the service passed for that series (bands F1/F2/F3, monthly value);
 * - published and used: the approved version the engine selects for the month, company by company.
 */
export type ServiceJob = "gme" | "regulatory" | "audit-pun";
export type ServiceMode = "DRY_RUN" | "PUBLISH";
export interface ServiceRunRecord {
  readonly runId: string;
  readonly job: ServiceJob;
  readonly mode: ServiceMode;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly identity: string;
  readonly outcome: "OK" | "PARTIAL" | "FAILED" | "ALREADY_RUNNING";
  readonly nextCheckAt: string;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly errors: readonly string[];
}

export type PunField = "f1" | "f2" | "f3" | "monthly";
export interface ServiceError { readonly code: string; readonly message: string; readonly scope: string | null; readonly informative: boolean }
export interface SourceStatus {
  readonly source: "GME" | "ARERA" | "TERNA";
  readonly label: string;
  readonly job: ServiceJob;
  readonly schedule: string;
  readonly status: "OK" | "WARNING" | "FAILED" | "NEVER_RUN" | "LATE";
  readonly statusLabel: string;
  readonly lastRun: { readonly startedAt: string; readonly finishedAt: string; readonly durationMs: number; readonly mode: ServiceMode; readonly modeLabel: string; readonly outcome: ServiceRunRecord["outcome"]; readonly outcomeLabel: string; readonly nextCheckAt: string } | null;
  readonly errors: readonly ServiceError[];
  readonly details: readonly string[];
  /** ARERA and Terna values read in the last run (Tony 23/11/2026): test mode means read and checked, not published. */
  readonly values: readonly AcquiredValueView[];
}
export interface AcquiredValueView { readonly tenantLabel: string; readonly identifier: string; readonly component: string; readonly customerScope: string; readonly period: string; readonly value: number; readonly unit: string; readonly source: string; readonly sha256: string | null }
export interface AcquiredSeries { readonly validated: boolean; readonly values: Partial<Record<PunField, number>>; readonly hours: readonly number[] | null; readonly url: string | null; readonly sha256: string | null; readonly newsletter: string | null; readonly note: string }
export interface GmeMonthView {
  readonly month: string;
  readonly label: string;
  readonly acquired: { readonly at: string; readonly mode: ServiceMode; readonly modeLabel: string; readonly state: string; readonly stateLabel: string; readonly bands: AcquiredSeries; readonly monthly: AcquiredSeries; readonly errors: readonly ServiceError[] } | null;
  readonly reference: { readonly at: string; readonly values: Partial<Record<PunField, number>>; readonly newsletter: string | null; readonly sources: readonly string[]; readonly errors: readonly ServiceError[] } | null;
  readonly used: readonly UsedPun[];
  readonly comparison: readonly PunComparison[];
  /** Parametro art. 5.2 delib. ARERA 300/05 (Tony 22/11/2026): its own series, shown apart, never used in place of the PUN. */
  readonly punop: PunopView | null;
  /**
   * Tony (24/11/2026, automazione PUN ufficiale): replacement of a computed monthly value by the version documented by the GME
   * PDFs, company by company: version replaced (kept), version published, outcome and differences found. Null when not relevant.
   */
  readonly replacement: ReplacementView | null;
  readonly level: "PUBLISHED_IN_USE" | "VALIDATED_NOT_PUBLISHED" | "ACQUIRED_NOT_VALIDATED" | "MISSING";
  readonly levelLabel: string;
}
export interface ReplacementRow {
  readonly tenantId: string;
  readonly label: string;
  readonly replaced: { readonly archiveId: string; readonly version: string; readonly monthly: number | null; readonly sourceId: string | null } | null;
  readonly published: { readonly archiveId: string; readonly version: string } | null;
  readonly outcome: string;
  readonly outcomeLabel: string;
  readonly differences: readonly string[];
}
export interface ReplacementView { readonly state: string; readonly stateLabel: string; readonly enabled: boolean; readonly rows: readonly ReplacementRow[] }
export interface PunopView {
  readonly seriesId: string;
  readonly meaning: string;
  readonly value: number | null;
  readonly unit: "€/MWh";
  readonly label: string | null;
  readonly url: string | null;
  readonly sha256: string | null;
  readonly validated: boolean;
  readonly conserved: boolean;
  readonly note: string;
  readonly errors: readonly ServiceError[];
  readonly usage: string;
}
export interface SourcePageView { readonly id: string; readonly url: string; readonly meaning: string; readonly reachable: boolean; readonly detail: string }
export interface UsedPun {
  readonly tenantId: string;
  readonly label: string;
  readonly status: "IN_USE" | "MISSING";
  readonly archiveId: string | null;
  readonly version: string | null;
  readonly values: Partial<Record<PunField, number>>;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly officialSource: boolean;
  readonly approvedAt: string | null;
  readonly writtenByService: boolean;
  /**
   * Tony (23/11/2026): where the monthly value in use comes from. DOCUMENT = printed by the document of the version (newsletter
   * GME, or a complete GME publication); DERIVED = computed from the bands of "Prezzo medio per fasce" or from the 15-minute
   * archive, which print no monthly value; NONE = no monthly value in the version.
   */
  readonly monthlyOrigin: "DOCUMENT" | "DERIVED" | "NONE";
}
export interface PunComparison { readonly tenantId: string; readonly label: string; readonly field: PunField; readonly service: number | null; readonly serviceOrigin: "ACQUISIZIONE" | "AUDIT" | null; readonly engine: number | null; readonly outcome: "MATCH" | "DIVERGENT" | "ENGINE_MISSING" | "SERVICE_MISSING"; readonly outcomeLabel: string }
export interface Anomaly { readonly id: string; readonly severity: "BLOCKING" | "WARNING" | "INFO"; readonly severityLabel: string; readonly source: string; readonly period: string | null; readonly origin: string; readonly message: string; readonly at: string | null }
export interface RegulatoryInUse { readonly source: "ARERA" | "TERNA"; readonly name: string; readonly lastAvailable: string | null; readonly lastData: string | null; readonly statusLabel: string }
export interface OfficialDataOverview {
  readonly generatedAt: string;
  readonly window: readonly string[];
  readonly service: { readonly mode: ServiceMode | "UNKNOWN"; readonly modeLabel: string; readonly lastRunAt: string | null; readonly runs: number; readonly publicationActive: boolean };
  readonly sources: readonly SourceStatus[];
  readonly gme: readonly GmeMonthView[];
  readonly regulatoryInUse: readonly RegulatoryInUse[];
  /** The GME publication pages the service reads (Tony 22/11/2026), each with its meaning; null before the first report of them. */
  readonly gmePages: readonly SourcePageView[] | null;
  readonly anomalies: readonly Anomaly[];
  readonly history: readonly { readonly runId: string; readonly job: ServiceJob; readonly jobLabel: string; readonly startedAt: string; readonly durationMs: number; readonly modeLabel: string; readonly outcomeLabel: string; readonly errors: readonly ServiceError[] }[];
}

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const monthLabel = (month: string) => /^\d{4}-\d{2}$/.test(month) ? `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` : month;
const MODE_LABEL: Readonly<Record<ServiceMode, string>> = { DRY_RUN: "Prova: scarica e verifica, non pubblica", PUBLISH: "Pubblicazione automatica attiva" };
const OUTCOME_LABEL: Readonly<Record<ServiceRunRecord["outcome"], string>> = { OK: "Riuscita", PARTIAL: "Riuscita con anomalie", FAILED: "Non riuscita", ALREADY_RUNNING: "Saltata: esecuzione già in corso" };
const JOB_LABEL: Readonly<Record<ServiceJob, string>> = { gme: "GME, PUN mensile e fasce", regulatory: "ARERA e Terna", "audit-pun": "Audit PUN giugno–ottobre" };
const STATE_LABEL: Readonly<Record<string, string>> = {
  READY_DRY_RUN: "Validato in prova, non pubblicato", PUBLISHED: "Pubblicato dal servizio", UNCHANGED: "Già pubblicato, invariato",
  LEGACY_AUDIT: "Versione precedente al servizio: verificata dall'audit settimanale", INCOMPLETE: "Documenti GME non ancora pubblicati", FAILED: "Non validato",
  REPLACEMENT_READY: "PUN mensile calcolato: sostituzione documentata pronta, non eseguita", REPLACED: "PUN mensile calcolato sostituito dalla versione documentata",
  REPLACEMENT_BLOCKED: "Sostituzione bloccata: documento mancante, illeggibile o incoerente, nessuna versione approvata",
  REPLACEMENT_PARTIAL: "Sostituzione incompleta: ripresa alla prossima esecuzione",
};
const REPLACEMENT_OUTCOME_LABEL: Readonly<Record<string, string>> = {
  WOULD_REPLACE: "Pronta: verrebbe creata una nuova versione", REPLACED: "Nuova versione pubblicata, precedente conservata", PUBLISHED: "Nuova versione pubblicata",
  UNCHANGED: "Già sostituita, invariata", REPLACEMENT_BLOCKED: "Bloccata, nessuna scrittura",
  PREPARED_NOT_APPROVED: "Preparata, non ancora approvata: il simulatore usa ancora la versione precedente",
};
const LEVEL_LABEL: Readonly<Record<GmeMonthView["level"], string>> = {
  PUBLISHED_IN_USE: "Pubblicato e usato nelle simulazioni", VALIDATED_NOT_PUBLISHED: "Validato, non pubblicato",
  ACQUIRED_NOT_VALIDATED: "Acquisito, non validato", MISSING: "Mancante: simulazioni del mese bloccate",
};
const COMPARISON_LABEL: Readonly<Record<PunComparison["outcome"], string>> = { MATCH: "Coincide", DIVERGENT: "Diverso", ENGINE_MISSING: "Non usato dal motore", SERVICE_MISSING: "Non ancora letto dal servizio" };
const SCHEDULE: Readonly<Record<ServiceJob, { readonly label: string; readonly maxAgeHours: number }>> = {
  gme: { label: "ogni giorno alle 05:20 UTC", maxAgeHours: 30 }, regulatory: { label: "ogni giorno alle 03:40 UTC", maxAgeHours: 30 }, "audit-pun": { label: "ogni lunedì alle 06:00 UTC", maxAgeHours: 8 * 24 },
};
const FIELDS: readonly PunField[] = ["f1", "f2", "f3", "monthly"];
export const PLATFORM_TENANT = "tenant_piattaforma";
/** The engine reads only PUN records (CTE index "PUN"): the 300/05 parameter is archived and shown, never used in its place. */
export const PUNOP_USAGE = "Non usato dal motore di simulazione: le CTE indicizzate del simulatore fanno riferimento al PUN, mai a questo parametro";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown): string | null => typeof value === "string" ? value : null;
const round2 = (value: number) => Math.round(value * 100) / 100;
const duration = (run: ServiceRunRecord) => Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)) || 0;

/** Keeps only well-formed reports: a malformed record is ignored, never shown as data. */
export function parseServiceRun(value: unknown): ServiceRunRecord | null {
  if (!isObject(value)) return null;
  const job = value.job; const mode = value.mode; const outcome = value.outcome;
  if (job !== "gme" && job !== "regulatory" && job !== "audit-pun") return null;
  if (mode !== "DRY_RUN" && mode !== "PUBLISH") return null;
  if (outcome !== "OK" && outcome !== "PARTIAL" && outcome !== "FAILED" && outcome !== "ALREADY_RUNNING") return null;
  const startedAt = text(value.startedAt); const finishedAt = text(value.finishedAt);
  if (!startedAt || !finishedAt || !Number.isFinite(Date.parse(startedAt))) return null;
  return {
    runId: text(value.runId) ?? "", job, mode, outcome, startedAt, finishedAt, identity: text(value.identity) ?? "", nextCheckAt: text(value.nextCheckAt) ?? "",
    summary: isObject(value.summary) ? value.summary : {}, errors: Array.isArray(value.errors) ? value.errors.filter((item): item is string => typeof item === "string") : [],
  };
}

const PREFIX_LABEL: Readonly<Record<string, string>> = { ARERA: "ARERA", ARERA_CAPACITY: "ARERA, capacità", TERNA_CAPACITY: "Terna, capacità", TERNA_TIDE: "Terna, dispacciamento (TIDE)" };
/** Service error codes in plain Italian; the original code stays visible next to the message. */
export function describeServiceError(raw: string): ServiceError {
  let rest = raw.trim(); let scope: string | null = null;
  const tenant = /^(tenant_[a-z0-9-]+)\s+(.*)$/.exec(rest); if (tenant) { scope = tenant[1]; rest = tenant[2]; }
  const month = /^(\d{4}-\d{2}):(.*)$/.exec(rest); if (month) { scope = monthLabel(month[1]); rest = month[2]; }
  const source = /^(ARERA_CAPACITY|ARERA|TERNA_CAPACITY|TERNA_TIDE):(.*)$/.exec(rest);
  if (source) rest = source[2];
  // Terna errors name the quarter ("2026Q4:TERNA_CAPACITY_VALUE_NOT_FOUND"): shown as "4° trimestre 2026", not as a code.
  const quarter = /^(\d{4})Q([1-4]):(.*)$/.exec(rest); if (quarter) rest = quarter[3];
  const where = [source ? PREFIX_LABEL[source[1]] : null, quarter ? `${quarter[2]}° trimestre ${quarter[1]}` : null].filter(Boolean).join(", ");
  const prefix = where ? `${where}: ` : "";
  const [code, ...details] = rest.split(":"); const detail = details.join(":").trim();
  const known: Readonly<Record<string, string>> = {
    GME_NEWSLETTER_CHECKS: "Newsletter GME (PUN mensile): controlli non superati",
    GME_NEWSLETTER_NOT_PUBLISHED_YET: "Newsletter GME del mese non ancora pubblicata",
    GME_NEWSLETTER_DOWNLOAD: "Newsletter GME: download non riuscito",
    GME_BANDS_PDF_NOT_FOUND: "PDF GME «Prezzo medio per fasce» del mese non ancora pubblicato",
    GME_BANDS_CHECKS: "PDF GME «Prezzo medio per fasce»: controlli non superati",
    GME_BANDS_DOWNLOAD: "PDF GME «Prezzo medio per fasce»: download non riuscito",
    GME_MONTHLY_INCONSISTENT: "PUN mensile non coerente con le fasce dello stesso mese",
    OFFICIAL_PUBLISH_OUTSIDE_WINDOW: "Mese fuori dalla finestra operativa dei sei mesi",
    NEWSLETTER_NOT_FOUND: "Audit: newsletter GME del mese non trovata",
    NEWSLETTER_CHECKS: "Audit: newsletter GME con controlli non superati",
    BANDS_CHECKS: "Audit: PDF fasce con controlli non superati",
    BANDS_PDF_UNREACHABLE: "Audit: PDF fasce non raggiungibile",
    SERVICE_JOB_FAILED: "Esecuzione interrotta",
    TERNA_CAPACITY_VALUE_NOT_FOUND: "corrispettivo non trovato nel documento ufficiale Terna",
    TERNA_CAPACITY_VALUE_IMPLAUSIBLE: "corrispettivo letto fuori dal campo ammesso",
    TERNA_CAPACITY_DOCUMENT_NOT_PUBLISHED: "documento Terna del trimestre non ancora pubblicato",
    TERNA_TIDE_VALUE_NOT_FOUND: "corrispettivo non trovato nel documento ufficiale Terna",
    TERNA_TIDE_DOCUMENT_NOT_PUBLISHED: "documento Terna del trimestre non ancora pubblicato",
  };
  const message = known[code] ?? (/^SERVICE_DB_/.test(code) ? "Connessione al database del servizio non riuscita" : /^SERVICE_/.test(code) ? "Configurazione del servizio non valida" : code.replace(/_/g, " ").toLowerCase());
  return { code, message: `${prefix}${message}${detail ? `: ${detail}` : ""}`, scope, informative: /NOT_PUBLISHED_YET|GME_BANDS_PDF_NOT_FOUND/.test(code) };
}

const sortedRuns = (runs: readonly ServiceRunRecord[]) => [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
const latest = (runs: readonly ServiceRunRecord[], job: ServiceJob, scope?: "arera" | "terna") => sortedRuns(runs).find((run) => run.job === job && run.outcome !== "ALREADY_RUNNING" && (scope === undefined || run.summary.scope === undefined || run.summary.scope === null || run.summary.scope === scope)) ?? null;

function sourceStatus(source: SourceStatus["source"], label: string, job: ServiceJob, run: ServiceRunRecord | null, now: string, errors: readonly ServiceError[], details: readonly string[], values: readonly AcquiredValueView[]): SourceStatus {
  const schedule = SCHEDULE[job];
  if (!run) return { source, label, job, schedule: schedule.label, status: "NEVER_RUN", statusLabel: "Mai eseguito dal servizio", lastRun: null, errors: [], details, values };
  const late = Date.parse(now) - Date.parse(run.startedAt) > schedule.maxAgeHours * 3_600_000;
  const blocking = errors.filter((error) => !error.informative);
  const status: SourceStatus["status"] = run.outcome === "FAILED" ? "FAILED" : late ? "LATE" : blocking.length ? "WARNING" : "OK";
  const statusLabel = status === "FAILED" ? "Non riuscito" : status === "LATE" ? `In ritardo: nessuna esecuzione da oltre ${schedule.maxAgeHours} ore` : status === "WARNING" ? "Eseguito con anomalie" : "Eseguito senza anomalie";
  return { source, label, job, schedule: schedule.label, status, statusLabel, lastRun: { startedAt: run.startedAt, finishedAt: run.finishedAt, durationMs: duration(run), mode: run.mode, modeLabel: MODE_LABEL[run.mode], outcome: run.outcome, outcomeLabel: OUTCOME_LABEL[run.outcome], nextCheckAt: run.nextCheckAt }, errors, details, values };
}

const fieldsOf = (record: MarketArchiveRecord): Partial<Record<PunField, number>> => {
  const market = record.record as unknown as Partial<Record<PunField, { readonly value?: unknown }>>;
  const out: Partial<Record<PunField, number>> = {};
  for (const field of FIELDS) { const value = market[field]?.value; if (finite(value)) out[field] = value; }
  return out;
};
const officialSource = (record: MarketArchiveRecord) => {
  const source = record.record.source as { readonly url?: string; readonly authority?: string; readonly sourceType?: string };
  try { const host = new URL(source.url ?? "").hostname; return (source.authority ?? "GME") === "GME" && (source.sourceType ?? "OFFICIAL") === "OFFICIAL" && /(^|\.)mercatoelettrico\.org$/.test(host); } catch { return false; }
};

/** The PUN version the engine uses for the month and company: the same read path as the calculation (no shortcut, no rewrite). */
export async function punUsedByEngine(repository: MarketArchiveRepository, tenantId: string, month: string, today: string): Promise<MarketArchiveRecord | null> {
  const view = operationalMarketView(repository, today);
  const records = await queryApprovedHistoricalMarketData(view, tenantId, `${month}-15`, "EE");
  return records.find((record) => record.index === "PUN" && record.month === month) ?? null;
}

interface TenantSummary { readonly tenantId: string; readonly outcome: string; readonly archiveId?: string; readonly version?: string; readonly archived?: { readonly monthly: number | null; readonly sourceId: string | null }; readonly replaces?: { readonly archiveId: string; readonly version: string; readonly monthly: number | null; readonly sourceId: string | null } | null; readonly differences?: readonly string[] }
interface MonthSummary { readonly month: string; readonly state: string; readonly tenants?: readonly TenantSummary[]; readonly bands: { f1: number; f2: number; f3: number; hours: number[]; sha256: string; url: string } | null; readonly monthly: { value: number; sha256: string; url: string; newsletter: string | null } | null; readonly errors: readonly string[]; readonly punop?: { readonly seriesId: string; readonly meaning: string; readonly value: number | null; readonly label: string | null; readonly url: string | null; readonly sha256: string | null; readonly conserved: unknown; readonly errors: readonly string[] } }
const monthSummaries = (run: ServiceRunRecord | null): readonly MonthSummary[] => Array.isArray(run?.summary.months) ? (run!.summary.months as unknown[]).filter(isObject).map((item) => item as unknown as MonthSummary).filter((item) => typeof item.month === "string") : [];
interface AuditSummary { readonly month: string; readonly at: string; readonly official: { monthly: number | null; newsletter: string | null; newsletterUrl: string | null; f1: number | null; f2: number | null; f3: number | null; bandsUrl: string | null }; readonly errors: readonly string[] }
const auditSummaries = (run: ServiceRunRecord | null): readonly AuditSummary[] => Array.isArray(run?.summary.audits) ? (run!.summary.audits as unknown[]).filter(isObject).map((item) => item as unknown as AuditSummary).filter((item) => typeof item.month === "string" && isObject(item.official)) : [];

export interface OverviewInput {
  readonly now: string;
  readonly runs: readonly unknown[];
  readonly alerts: readonly OfficialAlert[];
  readonly market: MarketArchiveRepository;
  readonly tenants: readonly { readonly tenantId: string; readonly label: string }[];
  readonly coverage: CoverageReport | null;
}

const DERIVED_MONTHLY_SOURCES: ReadonlySet<string> = new Set(["GME_PREZZO_MEDIO_FASCE", "GME_MGP_ANNUAL_ARCHIVE"]);
function monthlyOriginOf(record: MarketArchiveRecord): UsedPun["monthlyOrigin"] {
  const value = record.record as unknown as { readonly monthly?: { readonly value?: unknown }; readonly source?: { readonly sourceId?: string }; readonly officialComponents?: { readonly monthly?: unknown } };
  if (!finite(value.monthly?.value)) return "NONE";
  if (value.officialComponents?.monthly) return "DOCUMENT";
  return DERIVED_MONTHLY_SOURCES.has(value.source?.sourceId ?? "") ? "DERIVED" : "DOCUMENT";
}

export async function officialDataOverview(input: OverviewInput): Promise<OfficialDataOverview> {
  const runs = sortedRuns(input.runs.map(parseServiceRun).filter((run): run is ServiceRunRecord => run !== null));
  const today = romeToday(new Date(input.now));
  const window = operationalMarketMonths(today);
  const gmeRun = latest(runs, "gme"); const auditRun = latest(runs, "audit-pun");
  // ARERA and Terna can also run on their own (manual commands): each card shows the last run that covered its source.
  const areraRun = latest(runs, "regulatory", "arera"); const ternaRun = latest(runs, "regulatory", "terna");
  const label = (tenantId: string) => input.tenants.find((tenant) => tenant.tenantId === tenantId)?.label ?? tenantId;
  const anomalies: Anomaly[] = [];
  const addAnomaly = (anomaly: Omit<Anomaly, "severityLabel">) => anomalies.push({ ...anomaly, severityLabel: anomaly.severity === "BLOCKING" ? "Bloccante" : anomaly.severity === "WARNING" ? "Da verificare" : "Informativa" });

  // GME, month by month.
  const summaries = monthSummaries(gmeRun); const audits = auditSummaries(auditRun);
  const gme: GmeMonthView[] = [];
  for (const month of window) {
    const summary = summaries.find((item) => item.month === month) ?? null;
    const audit = audits.find((item) => item.month === month) ?? null;
    const errors = (summary?.errors ?? []).map(describeServiceError);
    const monthlyError = errors.find((error) => /NEWSLETTER|MONTHLY/.test(error.code));
    const bandsError = errors.find((error) => /BANDS/.test(error.code));
    const acquired = summary && gmeRun ? {
      at: gmeRun.startedAt, mode: gmeRun.mode, modeLabel: MODE_LABEL[gmeRun.mode], state: summary.state, stateLabel: STATE_LABEL[summary.state] ?? summary.state, errors,
      bands: summary.bands ? { validated: true, values: { f1: summary.bands.f1, f2: summary.bands.f2, f3: summary.bands.f3 }, hours: summary.bands.hours ?? null, url: summary.bands.url, sha256: summary.bands.sha256, newsletter: null, note: "Tutti i controlli del PDF superati" }
        : { validated: false, values: {}, hours: null, url: null, sha256: null, newsletter: null, note: bandsError?.message ?? (summary.state === "LEGACY_AUDIT" ? "Non letto: mese verificato dall'audit settimanale" : "Non letto") },
      monthly: summary.monthly ? { validated: true, values: { monthly: summary.monthly.value }, hours: null, url: summary.monthly.url, sha256: summary.monthly.sha256, newsletter: summary.monthly.newsletter, note: `Newsletter GME n. ${summary.monthly.newsletter ?? "?"}, Tabella 1, Baseload` }
        : { validated: false, values: {}, hours: null, url: null, sha256: null, newsletter: null, note: monthlyError?.message ?? (summary.state === "LEGACY_AUDIT" ? "Non letto: mese verificato dall'audit settimanale" : "Non letto") },
    } : null;
    const auditValues: Partial<Record<PunField, number>> = {};
    if (audit) for (const field of FIELDS) { const value = audit.official[field]; if (finite(value)) auditValues[field] = value; }
    const reference = audit && auditRun ? { at: auditRun.startedAt, values: auditValues, newsletter: audit.official.newsletter, sources: [audit.official.newsletterUrl, audit.official.bandsUrl].filter((url): url is string => typeof url === "string"), errors: audit.errors.map(describeServiceError) } : null;
    const serviceValue = (field: PunField): { value: number; origin: "ACQUISIZIONE" | "AUDIT" } | null => {
      const fromRun = field === "monthly" ? acquired?.monthly.values.monthly : acquired?.bands.values[field];
      if (finite(fromRun)) return { value: fromRun, origin: "ACQUISIZIONE" };
      const fromAudit = auditValues[field];
      return finite(fromAudit) ? { value: fromAudit, origin: "AUDIT" } : null;
    };
    const used: UsedPun[] = []; const comparison: PunComparison[] = [];
    for (const tenant of input.tenants) {
      const record = await punUsedByEngine(input.market, tenant.tenantId, month, today).catch(() => null);
      const values = record ? fieldsOf(record) : {};
      used.push(record ? {
        tenantId: tenant.tenantId, label: tenant.label, status: "IN_USE", archiveId: record.archiveId, version: record.record.version, values,
        sourceName: (record.record.source as { name?: string }).name ?? null, sourceUrl: (record.record.source as { url?: string }).url ?? null, officialSource: officialSource(record),
        approvedAt: (record.approvals ?? []).filter((item) => item.decision === "APPROVED").at(-1)?.decidedAt ?? record.updatedAt, writtenByService: Boolean((record.record as unknown as { officialComponents?: unknown }).officialComponents),
        monthlyOrigin: monthlyOriginOf(record),
      } : { tenantId: tenant.tenantId, label: tenant.label, status: "MISSING", archiveId: null, version: null, values: {}, sourceName: null, sourceUrl: null, officialSource: false, approvedAt: null, writtenByService: false, monthlyOrigin: "NONE" });
      for (const field of FIELDS) {
        const service = serviceValue(field); const engine = values[field] ?? null;
        if (!service && engine === null) continue;
        const outcome: PunComparison["outcome"] = !service ? "SERVICE_MISSING" : engine === null ? "ENGINE_MISSING" : round2(engine) === round2(service.value) ? "MATCH" : "DIVERGENT";
        comparison.push({ tenantId: tenant.tenantId, label: tenant.label, field, service: service?.value ?? null, serviceOrigin: service?.origin ?? null, engine, outcome, outcomeLabel: COMPARISON_LABEL[outcome] });
      }
    }
    const inUse = used.some((item) => item.status === "IN_USE");
    const validated = Boolean(acquired && (acquired.bands.validated || acquired.monthly.validated));
    const level: GmeMonthView["level"] = inUse ? "PUBLISHED_IN_USE" : validated ? "VALIDATED_NOT_PUBLISHED" : acquired ? "ACQUIRED_NOT_VALIDATED" : "MISSING";
    const partial = level === "VALIDATED_NOT_PUBLISHED" && acquired && acquired.bands.validated !== acquired.monthly.validated
      ? `${acquired.bands.validated ? "Fasce F1, F2, F3 validate" : "PUN mensile validato"}, ${acquired.bands.validated ? "PUN mensile non validato" : "fasce non validate"}: non pubblicato${acquired.mode === "DRY_RUN" ? " (modalità prova)" : ""}` : null;
    const p = summary?.punop;
    const punopErrors = (p?.errors ?? []).map(describeServiceError);
    const punop: PunopView | null = p && isObject(p) ? {
      seriesId: String(p.seriesId), meaning: String(p.meaning), value: finite(p.value) ? p.value : null, unit: "€/MWh", label: p.label ?? null, url: p.url ?? null, sha256: p.sha256 ?? null,
      validated: finite(p.value), conserved: Boolean(p.conserved),
      note: finite(p.value) ? `Tutti i controlli del PDF superati${p.label ? ` (${p.label})` : ""}` : punopErrors[0]?.message ?? "Non letto",
      errors: punopErrors,
      usage: PUNOP_USAGE,
    } : null;
    const replacement: ReplacementView | null = summary && /^REPLACE/.test(summary.state) ? {
      state: summary.state, stateLabel: STATE_LABEL[summary.state] ?? summary.state, enabled: typeof gmeRun?.summary.replacement === "string" && /^ENABLED/.test(gmeRun.summary.replacement),
      rows: (Array.isArray(summary.tenants) ? summary.tenants : []).filter(isObject).map((item) => item as unknown as TenantSummary).filter((item) => typeof item.tenantId === "string" && typeof item.outcome === "string").map((item) => {
        const written = item.outcome === "REPLACED" || item.outcome === "PUBLISHED" || item.outcome === "UNCHANGED";
        const replaced = item.replaces ?? (item.archiveId && item.version && !written ? { archiveId: item.archiveId, version: item.version, monthly: item.archived?.monthly ?? null, sourceId: item.archived?.sourceId ?? null } : null);
        return { tenantId: item.tenantId, label: label(item.tenantId), replaced, published: written && item.archiveId && item.version ? { archiveId: item.archiveId, version: item.version } : null, outcome: item.outcome, outcomeLabel: REPLACEMENT_OUTCOME_LABEL[item.outcome] ?? item.outcome, differences: Array.isArray(item.differences) ? item.differences : [] };
      }),
    } : null;
    gme.push({ month, label: monthLabel(month), acquired, reference, used, comparison, punop, replacement, level, levelLabel: partial ?? LEVEL_LABEL[level] });
    if (replacement?.state === "REPLACEMENT_PARTIAL") addAnomaly({ id: `replacement-partial-${month}`, severity: "BLOCKING", source: "GME", period: monthLabel(month), origin: "Sostituzione PUN mensile calcolato", message: `Sostituzione incompleta: ${replacement.rows.filter((row) => row.outcome === "PREPARED_NOT_APPROVED").map((row) => row.label).join(", ")} ancora sulla versione precedente, ${replacement.rows.filter((row) => row.published).map((row) => row.label).join(", ")} sulla versione documentata. Ripresa automatica alla prossima esecuzione.`, at: gmeRun?.startedAt ?? null });
    if (replacement?.state === "REPLACEMENT_BLOCKED") addAnomaly({ id: `replacement-blocked-${month}`, severity: "WARNING", source: "GME", period: monthLabel(month), origin: "Sostituzione PUN mensile calcolato", message: `Sostituzione non possibile: ${(summary?.errors ?? []).map((error) => describeServiceError(error).message).join("; ") || "documenti non validati"}. Nessuna versione scritta.`, at: gmeRun?.startedAt ?? null });
    for (const error of punopErrors.filter((entry) => !entry.informative)) addAnomaly({ id: `punop-${month}-${error.code}`, severity: "WARNING", source: "GME", period: monthLabel(month), origin: "Parametro art. 5.2 delib. 300/05", message: error.message, at: gmeRun?.startedAt ?? null });

    const name = monthLabel(month);
    for (const item of used.filter((entry) => entry.status === "MISSING")) addAnomaly({ id: `missing-${month}-${item.tenantId}`, severity: "BLOCKING", source: "GME", period: name, origin: "Dati usati dal simulatore", message: `${item.label}: nessun PUN approvato per ${name}. Le simulazioni con bollette di questo mese non possono essere calcolate.`, at: null });
    for (const item of used.filter((entry) => entry.status === "IN_USE" && !entry.officialSource)) addAnomaly({ id: `unofficial-${month}-${item.tenantId}`, severity: "WARNING", source: "GME", period: name, origin: "Dati usati dal simulatore", message: `${item.label}: la versione in uso (${item.archiveId}, v${item.version}) non indica un documento GME ufficiale come fonte.`, at: null });
    for (const item of used.filter((entry) => entry.status === "IN_USE" && entry.monthlyOrigin === "DERIVED")) addAnomaly({ id: `derived-monthly-${month}-${item.tenantId}`, severity: "WARNING", source: "GME", period: name, origin: "Dati usati dal simulatore", message: `${item.label}: il PUN mensile in uso (${round2(item.values.monthly!)} €/MWh, ${item.archiveId} v${item.version}) è ricavato dalle fasce o dalla media dei 15 minuti: nessun documento lo stampa. Va sostituito con la versione documentata (newsletter GME, Tabella 1).`, at: null });
    for (const item of comparison.filter((entry) => entry.outcome === "DIVERGENT")) addAnomaly({ id: `divergent-${month}-${item.tenantId}-${item.field}`, severity: "WARNING", source: "GME", period: name, origin: item.serviceOrigin === "AUDIT" ? "Confronto con l'audit settimanale" : "Confronto servizio / motore", message: `${item.label}, ${item.field === "monthly" ? "PUN mensile" : item.field.toUpperCase()}: GME ${item.service} €/MWh, motore ${round2(item.engine!)} €/MWh.`, at: null });
    for (const error of errors.filter((entry) => !entry.informative)) addAnomaly({ id: `gme-${month}-${error.code}`, severity: inUse ? "WARNING" : "BLOCKING", source: "GME", period: name, origin: "Ultima esecuzione del servizio", message: error.message, at: gmeRun?.startedAt ?? null });
  }

  // Sources.
  const gmeErrors = (gmeRun?.errors ?? []).map(describeServiceError);
  const gmeDetails = gmeRun ? [`Documenti scaricati: ${Array.isArray(gmeRun.summary.downloads) ? gmeRun.summary.downloads.length : 0}`, `Mesi verificati: ${summaries.length}`, `Sostituzione dei PUN mensili calcolati: ${gmeRun.summary.replacement === "ENABLED" ? "attiva con la pubblicazione" : typeof gmeRun.summary.replacement === "string" && gmeRun.summary.replacement.startsWith("ENABLED_REPLACEMENT_ONLY") ? `autorizzata da sola${gmeRun.summary.replacement.includes(":") ? ` per ${gmeRun.summary.replacement.split(":")[1].split(",").map(monthLabel).join(", ")}` : " per tutti i mesi"}` : gmeRun.summary.replacement === "INVALID_CONFIGURATION" ? "configurazione non valida, nessuna sostituzione" : "non attiva (solo verifica)"}`] : [];
  const tenantsOf = (run: ServiceRunRecord | null) => Array.isArray(run?.summary.tenants) ? (run!.summary.tenants as unknown[]).filter(isObject) : [];
  const stepLabel = (value: unknown) => value === "SUCCESS" ? "riuscito" : value === "PARTIAL_FAILURE" ? "con anomalie" : value === "FAILED" ? "non riuscito" : value === "SKIPPED" ? "non eseguito in questo comando" : typeof value === "string" ? value.toLowerCase().replace(/_/g, " ") : "non eseguito";
  const areraDetails = tenantsOf(areraRun).map((item) => `${label(String(item.tenantId))}: tariffe ${stepLabel(item.arera)}, capacità ${stepLabel(item.capacity)}`);
  const ternaDetails = tenantsOf(ternaRun).map((item) => `${label(String(item.tenantId))}: capacità ${stepLabel(item.terna)}, dispacciamento ${stepLabel(item.tide)}`);
  const valuesOf = (run: ServiceRunRecord | null, authority: "ARERA" | "TERNA"): AcquiredValueView[] => (Array.isArray(run?.summary.acquired) ? (run!.summary.acquired as unknown[]).filter(isObject) : [])
    .filter((item) => item.authority === authority && typeof item.value === "number" && Number.isFinite(item.value))
    .map((item) => ({ tenantLabel: label(String(item.tenantId)), identifier: String(item.identifier ?? ""), component: String(item.component ?? ""), customerScope: String(item.customerScope ?? ""), period: `dal ${String(item.effectiveFrom ?? "—")}${item.effectiveTo ? ` al ${String(item.effectiveTo)}` : ""}`, value: item.value as number, unit: String(item.unit ?? ""), source: String(item.source ?? ""), sha256: typeof item.sha256 === "string" ? item.sha256 : null }))
    .slice(0, 120);
  const sources: SourceStatus[] = [
    sourceStatus("GME", "GME: PUN Index mensile, fasce F1, F2, F3, parametro 300/05", "gme", gmeRun, input.now, gmeErrors, gmeDetails, []),
    sourceStatus("ARERA", "ARERA, tariffe e oneri regolati", "regulatory", areraRun, input.now, (areraRun?.errors ?? []).map(describeServiceError).filter((error) => /^ARERA/.test(error.message)), areraDetails, valuesOf(areraRun, "ARERA")),
    sourceStatus("TERNA", "Terna, dispacciamento e capacità", "regulatory", ternaRun, input.now, (ternaRun?.errors ?? []).map(describeServiceError).filter((error) => /^Terna/.test(error.message)), ternaDetails, valuesOf(ternaRun, "TERNA")),
  ];
  for (const source of sources) {
    if (source.status === "NEVER_RUN") addAnomaly({ id: `never-${source.source}`, severity: "WARNING", source: source.source, period: null, origin: "Stato del servizio", message: `${source.label}: il servizio non ha ancora registrato nessuna esecuzione (prevista ${source.schedule}).`, at: null });
    if (source.status === "LATE") addAnomaly({ id: `late-${source.source}`, severity: "WARNING", source: source.source, period: null, origin: "Stato del servizio", message: `${source.label}: ${source.statusLabel.toLowerCase()}.`, at: source.lastRun?.startedAt ?? null });
    if (source.status === "FAILED" && source.source !== "GME") addAnomaly({ id: `failed-${source.source}`, severity: "BLOCKING", source: source.source, period: null, origin: "Ultima esecuzione del servizio", message: `${source.label}: ${source.errors.slice(0, 3).map((error) => error.message).join("; ") || "esecuzione non riuscita"}.`, at: source.lastRun?.startedAt ?? null });
    if (source.status === "WARNING" && source.source !== "GME") for (const error of source.errors.slice(0, 6)) addAnomaly({ id: `${source.source}-${error.scope}-${error.code}`, severity: "WARNING", source: source.source, period: null, origin: "Ultima esecuzione del servizio", message: `${error.scope ? `${label(error.scope)}: ` : ""}${error.message}`, at: source.lastRun?.startedAt ?? null });
  }
  if (gmeRun?.outcome === "FAILED") addAnomaly({ id: "failed-GME", severity: "BLOCKING", source: "GME", period: null, origin: "Ultima esecuzione del servizio", message: gmeErrors.map((error) => error.message).join("; ") || "esecuzione non riuscita", at: gmeRun.startedAt });
  for (const alert of input.alerts.filter((item) => item.status !== "RESOLVED" && (item.source === "GME" || item.source === "ARERA" || item.source === "TERNA"))) addAnomaly({ id: `alert-${alert.alertId}`, severity: "WARNING", source: alert.source, period: alert.period, origin: "Alert della Control Room", message: `${alert.document}: ${alert.reason}`, at: alert.lastCheckedAt });

  const regulatoryInUse: RegulatoryInUse[] = (input.coverage?.archives ?? []).filter((archive) => archive.source === "ARERA" || archive.source === "TERNA").flatMap((archive) => archive.components.map((component) => ({ source: archive.source as "ARERA" | "TERNA", name: component.name, lastAvailable: component.lastAvailable, lastData: component.lastData, statusLabel: component.statusLabel })));
  const order = { BLOCKING: 0, WARNING: 1, INFO: 2 } as const;
  return {
    generatedAt: input.now, window,
    service: { mode: runs[0]?.mode ?? "UNKNOWN", modeLabel: runs[0] ? MODE_LABEL[runs[0].mode] : "Nessuna esecuzione registrata", lastRunAt: runs[0]?.startedAt ?? null, runs: runs.length, publicationActive: runs[0]?.mode === "PUBLISH" },
    sources, gme, regulatoryInUse,
    gmePages: Array.isArray(gmeRun?.summary.sources) ? (gmeRun!.summary.sources as unknown[]).filter(isObject).map((page) => ({ id: String(page.id), url: String(page.url), meaning: String(page.meaning), reachable: page.reachable === true, detail: String(page.detail ?? "") })) : null,
    anomalies: anomalies.sort((a, b) => order[a.severity] - order[b.severity]),
    history: runs.slice(0, 20).map((run) => ({ runId: run.runId, job: run.job, jobLabel: JOB_LABEL[run.job], startedAt: run.startedAt, durationMs: duration(run), modeLabel: run.mode === "DRY_RUN" ? "Prova" : "Pubblicazione", outcomeLabel: OUTCOME_LABEL[run.outcome], errors: run.errors.map(describeServiceError) })),
  };
}
