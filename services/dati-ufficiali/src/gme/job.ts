import { createHash } from "node:crypto";
import type { ElectricityMonthlyPunRecord } from "../../../../app/lib/energy/market-data";
import type { MarketArchiveRecord, MarketArchiveRepository } from "../../../../app/lib/market/types";
import { approveMarketArchive, compareMarketVersions, createMarketArchive } from "../../../../app/lib/market/service";
import { operationalMarketMonths, romeToday } from "../../../../app/lib/market/operational-window";
import { GME_PUN_BANDS_PUBLICATIONS_PAGE } from "../../../../app/lib/market/gme-pun-source";
import { GME_MONTHLY_BANDS_SOURCE_ID, findGmeMonthlyBandsPdf } from "../../../../app/lib/market/gme-monthly-bands";
import { readGmeBandsPdf } from "../../../../app/lib/official-monitor/gme-pun-bands";
import { catalogEntry, officialLinkFor } from "../../../../app/lib/official-monitor/catalog";
import type { ServiceStore } from "../store";
import { conserveDocument, listConserved, type ConservedDocument } from "../documents";
import { fetchDocument, type FetchedDocument, type OfficialFetch } from "../official-fetch";
import { GME_NEWSLETTER_SOURCE_ID, newsletterCandidates, readNewsletterPdf } from "./newsletter";
import { raiseAnomaly, recordCheck, resolveAnomaly, type ServiceMode } from "../status";
import { SERVICE_ACTOR } from "../identity";
import { GME_PUNOP_300_MEANING, GME_PUNOP_300_PAGE, GME_PUNOP_300_SERIES_ID, findPunopPdf, readPunopPdf } from "./punop";

/**
 * GME, automatic (Tony 21/11/2026, decisioni 2 e 3): for each month of the operational window
 * - F1, F2, F3 from the PDF "Prezzo medio per fasce" of the month (bands with their hours, unit, month);
 * - the PUN Index GME monthly value from the newsletter that reports on the month (Tabella 1, Baseload);
 * two distinct series, each from its own conserved document with its SHA-256. A document that gives only the bands publishes only
 * the bands; the monthly value is never derived. Publication is automatic only when every check passes, as a new version of the
 * month for every company, linked to the previous one (approved or rejected, which stays as it is with its audit).
 * Months whose approved version was not written by this service (earlier automation, or the manual refresh of the commercial
 * application) are never touched: their documents are still acquired and checked, never conserved or published, so the
 * Control Room can compare the archived values with what the documents print (Tony 23/11/2026, riconciliazione); the separate
 * audit (audit.ts) keeps its own months.
 */
export const SERVICE_COMPONENTS_FIELD = "officialComponents" as const;
/** Monthly vs hours-weighted bands: only a sanity check between two GME documents, never a source. */
export const MONTHLY_BANDS_TOLERANCE = 0.03;

export interface Component { readonly sourceId: string; readonly documentId: string; readonly url: string; readonly sha256: string; readonly retrievedAt: string }
export interface ServiceComponents { readonly bands?: Component; readonly monthly?: Component & { readonly newsletter: string | null } }
type ServicePunRecord = ElectricityMonthlyPunRecord & { readonly officialComponents?: ServiceComponents };

export interface MonthResult {
  readonly month: string;
  readonly state: "PUBLISHED" | "UNCHANGED" | "READY_DRY_RUN" | "LEGACY_AUDIT" | "INCOMPLETE" | "FAILED";
  readonly bands: { readonly f1: number; readonly f2: number; readonly f3: number; readonly hours: readonly number[]; readonly sha256: string; readonly url: string } | null;
  readonly monthly: { readonly value: number; readonly sha256: string; readonly url: string; readonly newsletter: string | null } | null;
  readonly tenants: readonly { readonly tenantId: string; readonly outcome: string; readonly archiveId?: string; readonly version?: string; readonly archived?: ArchivedValues }[];
  readonly errors: readonly string[];
  /** Parametro art. 5.2 delib. ARERA 300/05: its own series, never written into the PUN archive and never a PUN substitute. */
  readonly punop?: PunopResult;
}
/** What an approved version not written by the service holds, for comparison only: values and the source it declares. */
export interface ArchivedValues { readonly f1: number | null; readonly f2: number | null; readonly f3: number | null; readonly monthly: number | null; readonly sourceId: string | null; readonly sourceUrl: string | null }
const archivedValues = (record: MarketArchiveRecord): ArchivedValues => {
  const value = record.record as unknown as Readonly<Record<string, { readonly value?: unknown } | undefined>> & { readonly source?: { readonly sourceId?: string; readonly url?: string } };
  const read = (field: string) => typeof value[field]?.value === "number" && Number.isFinite(value[field]!.value) ? value[field]!.value as number : null;
  return { f1: read("f1"), f2: read("f2"), f3: read("f3"), monthly: read("monthly"), sourceId: value.source?.sourceId ?? null, sourceUrl: value.source?.url ?? null };
};

export interface PunopResult {
  readonly seriesId: typeof GME_PUNOP_300_SERIES_ID;
  readonly meaning: string;
  readonly value: number | null;
  readonly unit: "EUR_PER_MWH";
  readonly label: string | null;
  readonly url: string | null;
  readonly sha256: string | null;
  readonly conserved: { readonly documentId: string; readonly version: number } | null;
  readonly errors: readonly string[];
}

/** One month of the 300/05 parameter: the PDF linked on the GME page, read and checked; conserved only when publishing. */
export async function acquirePunop(input: { readonly store: ServiceStore; readonly fetcher: OfficialFetch; readonly recorded: readonly FetchedDocument[]; readonly month: string; readonly mode: ServiceMode; readonly pageHtml: () => Promise<string | null> }): Promise<PunopResult> {
  const base = { seriesId: GME_PUNOP_300_SERIES_ID, meaning: GME_PUNOP_300_MEANING, unit: "EUR_PER_MWH" as const };
  const html = await input.pageHtml();
  if (html === null) return { ...base, value: null, label: null, url: null, sha256: null, conserved: null, errors: ["GME_PUNOP_PAGE_UNREACHABLE"] };
  const url = findPunopPdf(html, input.month);
  if (!url) return { ...base, value: null, label: null, url: null, sha256: null, conserved: null, errors: ["GME_PUNOP_NOT_PUBLISHED_YET"] };
  let document: FetchedDocument;
  try { document = await fetchDocument(input.fetcher, url, input.recorded); }
  catch (error) { return { ...base, value: null, label: null, url, sha256: null, conserved: null, errors: [`GME_PUNOP_DOWNLOAD:${error instanceof Error ? error.message : "errore"}`] }; }
  const reading = readPunopPdf(document.bytes, input.month);
  const failed = reading.checks.filter((check) => !check.ok);
  if (failed.length || reading.value === null) return { ...base, value: null, label: reading.label, url, sha256: document.sha256, conserved: null, errors: [`GME_PUNOP_CHECKS:${failed.map((check) => `${check.code} ${check.detail}`).join("; ").slice(0, 300)}`] };
  let conserved: PunopResult["conserved"] = null;
  if (input.mode === "PUBLISH") {
    const { document: saved } = await conserveDocument(input.store, { document, kind: "GME_ARERA_300_05_PDF", source: "GME", period: input.month, checks: reading.checks, values: { seriesId: GME_PUNOP_300_SERIES_ID, meaning: GME_PUNOP_300_MEANING, value: reading.value, label: reading.label, unit: "EUR_PER_MWH" } });
    conserved = { documentId: saved.documentId, version: saved.version };
  }
  return { ...base, value: reading.value, label: reading.label, url, sha256: document.sha256, conserved, errors: [] };
}

const rate = (value: number) => ({ value, currency: "EUR" as const, unit: "EUR_PER_MWH" as const });
const versionOf = (value: string) => Number.parseInt(value, 10) || 0;
const nextMonthStart = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };
const componentsKey = (c: ServiceComponents) => createHash("sha256").update(`${c.bands?.sha256 ?? "-"}|${c.monthly?.sha256 ?? "-"}`).digest("hex").slice(0, 16);
const sameComponents = (a: ServiceComponents | undefined, b: ServiceComponents) => Boolean(a) && a!.bands?.sha256 === b.bands?.sha256 && a!.monthly?.sha256 === b.monthly?.sha256;

function currentApproved(records: readonly MarketArchiveRecord[], month: string): MarketArchiveRecord | undefined {
  return records.filter((record) => record.vector === "EE" && record.index === "PUN" && record.month === month && record.status === "APPROVED").sort(compareMarketVersions)[0];
}
const writtenByService = (record: MarketArchiveRecord | undefined) => Boolean(record && (record.record as ServicePunRecord).officialComponents);

/** Finds and reads the bands PDF of the month: the link on the GME page, or the exact file known in the catalog. */
async function acquireBands(fetcher: OfficialFetch, recorded: readonly FetchedDocument[], month: string, now: string): Promise<{ document: FetchedDocument; reading: ReturnType<typeof readGmeBandsPdf> } | { error: string }> {
  let url: string | null = null;
  try {
    const page = await fetchDocument(fetcher, GME_PUN_BANDS_PUBLICATIONS_PAGE, recorded);
    url = findGmeMonthlyBandsPdf(new TextDecoder().decode(page.bytes), month);
  } catch { /* the catalog link below is the fallback */ }
  const known = officialLinkFor(catalogEntry("GME_PUN_BANDS_DOCUMENT"), month);
  if (!url && /\.pdf$/i.test(known)) url = known;
  if (!url) return { error: "GME_BANDS_PDF_NOT_FOUND" };
  try {
    const document = await fetchDocument(fetcher, url, recorded);
    return { document, reading: readGmeBandsPdf(document.bytes, month, now) };
  } catch (error) { return { error: `GME_BANDS_DOWNLOAD:${error instanceof Error ? error.message : "errore"}` }; }
}

/** Finds the newsletter that reports on the month by its dated file name, on the GME hosts only. */
async function acquireNewsletter(fetcher: OfficialFetch, recorded: readonly FetchedDocument[], month: string, known: string | null): Promise<{ document: FetchedDocument; reading: ReturnType<typeof readNewsletterPdf> } | { error: string }> {
  const candidates = known ? [known, ...newsletterCandidates(month).filter((url) => url !== known)] : newsletterCandidates(month);
  for (const url of candidates) {
    let response: Response;
    try { response = await fetcher(url, { method: "HEAD" }); } catch { continue; }
    if (!response.ok || !/pdf/i.test(response.headers.get("content-type") ?? "")) continue;
    try {
      const document = await fetchDocument(fetcher, url, recorded);
      const reading = readNewsletterPdf(document.bytes, month);
      if (reading.checks.find((check) => check.code === "REPORT_MONTH")?.ok === false) continue;
      return { document, reading };
    } catch (error) { return { error: `GME_NEWSLETTER_DOWNLOAD:${error instanceof Error ? error.message : "errore"}` }; }
  }
  return { error: "GME_NEWSLETTER_NOT_PUBLISHED_YET" };
}

/** One new version of the month for one company, linked to the latest one; reused when the same documents are already there. */
async function publishTenant(repository: MarketArchiveRepository, tenantId: string, month: string, values: { f1?: number; f2?: number; f3?: number; monthly?: number }, components: ServiceComponents, now: string): Promise<{ outcome: "PUBLISHED" | "UNCHANGED" | "LEGACY_AUDIT"; archiveId?: string; version?: string }> {
  const sameMonth = (await repository.list(tenantId)).filter((record) => record.vector === "EE" && record.index === "PUN" && record.month === month);
  const current = currentApproved(sameMonth, month);
  if (current && !writtenByService(current)) return { outcome: "LEGACY_AUDIT", archiveId: current.archiveId, version: current.record.version };
  const decisionId = `svc-pun-${month}-${componentsKey(components)}-${tenantId}`;
  const done = sameMonth.find((record) => sameComponents((record.record as ServicePunRecord).officialComponents, components));
  if (done) {
    if (done.status === "APPROVED") return { outcome: "UNCHANGED", archiveId: done.archiveId, version: done.record.version };
    if (done.status !== "REJECTED") {
      await approveMarketArchive(repository, tenantId, done.archiveId, SERVICE_ACTOR, decisionId, now);
      return { outcome: "PUBLISHED", archiveId: done.archiveId, version: done.record.version };
    }
  }
  const latest = [...sameMonth].sort((a, b) => versionOf(b.record.version) - versionOf(a.record.version))[0];
  const version = (latest ? versionOf(latest.record.version) : 0) + 1;
  const recordId = version === 1 ? `gme-pun-${month}` : `gme-pun-${month}-v${version}`;
  const primary = components.bands ?? components.monthly!;
  const record = {
    schemaVersion: 1, recordId, version: String(version), parentVersionId: latest?.archiveId ?? null, tenantId,
    recordType: "MONTHLY_MARKET_DATA", vector: "EE", index: "PUN", month,
    ...(values.f1 !== undefined ? { f1: rate(values.f1), f2: rate(values.f2!), f3: rate(values.f3!) } : {}),
    ...(values.monthly !== undefined ? { monthly: rate(values.monthly) } : {}),
    source: { sourceId: primary.sourceId, name: components.bands && components.monthly ? "GME: Prezzo medio per fasce (F1, F2, F3) e Newsletter, Tabella 1 (PUN Index GME mensile)" : components.bands ? "GME Prezzo medio per fasce (solo F1, F2, F3)" : "GME Newsletter, Tabella 1 (solo PUN Index GME mensile)", url: primary.url, authority: "GME", sourceType: "OFFICIAL", sourceSha256: primary.sha256, relatedUrls: [components.bands?.url, components.monthly?.url].filter((url): url is string => Boolean(url)) },
    [SERVICE_COMPONENTS_FIELD]: components,
    approval: { status: "NEEDS_REVIEW", reason: "OFFICIAL_SOURCE_RECONCILED" }, publicationDate: null,
    effectiveFrom: `${month}-01`, effectiveTo: nextMonthStart(month),
  } as unknown as ElectricityMonthlyPunRecord;
  const created = await createMarketArchive(repository, { tenantId, record, archiveId: recordId, now, actor: SERVICE_ACTOR });
  await approveMarketArchive(repository, tenantId, created.archiveId, SERVICE_ACTOR, decisionId, now);
  return { outcome: "PUBLISHED", archiveId: created.archiveId, version: String(version) };
}

export async function runGmeJob(input: { readonly store: ServiceStore; readonly fetcher: OfficialFetch; readonly recorded: readonly FetchedDocument[]; readonly tenants: readonly string[]; readonly now: string; readonly mode: ServiceMode; readonly nextCheckAt: string; readonly months?: readonly string[]; readonly auditedMonths?: readonly string[] }): Promise<readonly MonthResult[]> {
  const market = input.store.market();
  const months = input.months ?? operationalMarketMonths(romeToday(new Date(input.now)));
  const window = operationalMarketMonths(romeToday(new Date(input.now)));
  const results: MonthResult[] = [];
  let punopPage: Promise<string | null> | null = null;
  const pageHtml = () => (punopPage ??= fetchDocument(input.fetcher, GME_PUNOP_300_PAGE, input.recorded).then((page) => new TextDecoder().decode(page.bytes)).catch(() => null));
  for (const month of months) {
    const errors: string[] = [];
    const before = results.length;
    // The 300/05 parameter is acquired for every month of the window, separately: its outcome never blocks or changes the PUN.
    const punop = window.includes(month) ? await acquirePunop({ store: input.store, fetcher: input.fetcher, recorded: input.recorded, month, mode: input.mode, pageHtml }).catch((error): PunopResult => ({ seriesId: GME_PUNOP_300_SERIES_ID, meaning: GME_PUNOP_300_MEANING, value: null, unit: "EUR_PER_MWH", label: null, url: null, sha256: null, conserved: null, errors: [`GME_PUNOP_FAILED:${error instanceof Error ? error.message : "errore"}`] })) : undefined;
    try {
      if (!window.includes(month)) { results.push({ month, state: "FAILED", bands: null, monthly: null, tenants: [], errors: ["OFFICIAL_PUBLISH_OUTSIDE_WINDOW"] }); continue; }
      const currents = await Promise.all(input.tenants.map(async (tenantId) => ({ tenantId, current: currentApproved(await market.list(tenantId), month) })));
      const serviceTargets = currents.filter((item) => !item.current || writtenByService(item.current));
      // A month with a version approved by the earlier automation in any company is left to the audit as a whole, so the
      // companies never end up with different sources for the same month (Tony 21/11/2026, decisione 4).
      const legacy = currents.some((item) => item.current && !writtenByService(item.current));
      const legacyTenants = () => currents.map((item) => ({ tenantId: item.tenantId, outcome: "LEGACY_AUDIT", archiveId: item.current?.archiveId, version: item.current?.record.version, ...(item.current ? { archived: archivedValues(item.current) } : {}) }));
      // Months of the weekly audit are compared there (same documents): not read twice.
      if (legacy && input.auditedMonths?.includes(month)) { results.push({ month, state: "LEGACY_AUDIT", bands: null, monthly: null, tenants: legacyTenants(), errors: [] }); continue; }
      // Documents of a legacy month are read and checked for comparison only: never conserved, never published.
      const conserve = input.mode === "PUBLISH" && !legacy;
      const existing = serviceTargets.map((item) => (item.current?.record as ServicePunRecord | undefined)?.officialComponents).find(Boolean);
      const conserved = await listConserved(input.store, undefined, month);
      const reuse = (kind: ConservedDocument["kind"], sha?: string) => sha ? conserved.find((doc) => doc.kind === kind && doc.sha256 === sha) : undefined;

      // F1, F2, F3: reuse the conserved document of the published version, otherwise acquire and check the PDF of the month.
      let bands: MonthResult["bands"] = null; let bandsComponent: Component | undefined;
      const bandsDoc = reuse("GME_PUN_BANDS_PDF", existing?.bands?.sha256);
      if (bandsDoc?.values) { const v = bandsDoc.values as { f1: number; f2: number; f3: number; hours: number[] }; bands = { f1: v.f1, f2: v.f2, f3: v.f3, hours: v.hours, sha256: bandsDoc.sha256, url: bandsDoc.url }; bandsComponent = existing!.bands; }
      else {
        const acquired = await acquireBands(input.fetcher, input.recorded, month, input.now);
        if ("error" in acquired) errors.push(acquired.error);
        else {
          const failed = acquired.reading.checks.filter((check) => !check.ok);
          if (failed.length || !acquired.reading.values) errors.push(`GME_BANDS_CHECKS:${failed.map((check) => `${check.code} ${check.detail}`).join("; ").slice(0, 300)}`);
          else {
            const v = acquired.reading.values;
            bands = { f1: v.f1, f2: v.f2, f3: v.f3, hours: v.hours, sha256: acquired.document.sha256, url: acquired.document.url };
            if (conserve) {
              const { document } = await conserveDocument(input.store, { document: acquired.document, kind: "GME_PUN_BANDS_PDF", source: "GME", period: month, checks: acquired.reading.checks, values: { f1: v.f1, f2: v.f2, f3: v.f3, hours: [...v.hours], unit: "EUR_PER_MWH" } });
              bandsComponent = { sourceId: GME_MONTHLY_BANDS_SOURCE_ID, documentId: document.documentId, url: document.url, sha256: document.sha256, retrievedAt: document.retrievedAt };
            }
          }
        }
      }

      // Monthly value: reuse the conserved newsletter of the published version, otherwise look for the newsletter of the month.
      let monthly: MonthResult["monthly"] = null; let monthlyComponent: ServiceComponents["monthly"];
      const monthlyDoc = reuse("GME_NEWSLETTER_PDF", existing?.monthly?.sha256);
      if (monthlyDoc?.values) { const v = monthlyDoc.values as { monthly: number; newsletter: string | null }; monthly = { value: v.monthly, sha256: monthlyDoc.sha256, url: monthlyDoc.url, newsletter: v.newsletter }; monthlyComponent = existing!.monthly; }
      else {
        const knownUrl = conserved.find((doc) => doc.kind === "GME_NEWSLETTER_PDF")?.url ?? null;
        const acquired = await acquireNewsletter(input.fetcher, input.recorded, month, knownUrl);
        if ("error" in acquired) errors.push(acquired.error);
        else {
          const failed = acquired.reading.checks.filter((check) => !check.ok);
          if (failed.length || acquired.reading.monthly === null) errors.push(`GME_NEWSLETTER_CHECKS:${failed.map((check) => `${check.code} ${check.detail}`).join("; ").slice(0, 300)}`);
          else {
            const checks = [...acquired.reading.checks];
            if (bands) {
              const hours = bands.hours.reduce((sum, h) => sum + h, 0);
              const weighted = (bands.f1 * bands.hours[0] + bands.f2 * bands.hours[1] + bands.f3 * bands.hours[2]) / hours;
              const gap = Math.abs(weighted - acquired.reading.monthly) / acquired.reading.monthly;
              checks.push({ code: "BANDS_CONSISTENCY", ok: gap <= MONTHLY_BANDS_TOLERANCE, detail: `controllo di coerenza tra documenti GME (non è una fonte): scarto ${(gap * 100).toFixed(2)}% (ammesso ${(MONTHLY_BANDS_TOLERANCE * 100).toFixed(0)}%)` });
            }
            if (checks.some((check) => !check.ok)) errors.push(`GME_MONTHLY_INCONSISTENT:${checks.filter((check) => !check.ok).map((check) => check.detail).join("; ")}`);
            else {
              monthly = { value: acquired.reading.monthly, sha256: acquired.document.sha256, url: acquired.document.url, newsletter: acquired.reading.number };
              if (conserve) {
                const { document } = await conserveDocument(input.store, { document: acquired.document, kind: "GME_NEWSLETTER_PDF", source: "GME", period: month, checks, values: { monthly: acquired.reading.monthly, newsletter: acquired.reading.number, table: "Tabella 1 MGP, dati di sintesi — PUN INDEX GME, Baseload", unit: "EUR_PER_MWH" } });
                monthlyComponent = { sourceId: GME_NEWSLETTER_SOURCE_ID, documentId: document.documentId, url: document.url, sha256: document.sha256, retrievedAt: document.retrievedAt, newsletter: acquired.reading.number };
              }
            }
          }
        }
      }

      // Not yet published is normal early in the month; anything else (download refused, checks failed, inconsistent
      // documents) stops the month: nothing is published until the anomaly is looked at.
      const blocking = errors.filter((error) => !/NOT_PUBLISHED_YET|GME_BANDS_PDF_NOT_FOUND/.test(error));
      if (legacy) { results.push({ month, state: "LEGACY_AUDIT", bands, monthly, tenants: legacyTenants(), errors }); continue; }
      if ((!bands && !monthly) || blocking.length) {
        const pending = !blocking.length;
        const alertId = input.mode === "PUBLISH" && !pending ? await raiseAnomaly(input.store, "GME_PUN_MONTH", month, `servizio automatico: ${blocking.join("; ")}`, input.now) : null;
        if (input.mode === "PUBLISH") await recordCheck(input.store, { code: "GME_PUN_MONTH", period: month, at: input.now, outcome: pending ? "COVERED" : "FAILED", detail: pending ? "documenti GME del mese non ancora pubblicati" : `nessuna pubblicazione: ${blocking.join("; ")}`, nextCheckAt: input.nextCheckAt, alertId });
        results.push({ month, state: pending ? "INCOMPLETE" : "FAILED", bands, monthly, tenants: [], errors }); continue;
      }
      if (input.mode === "DRY_RUN") { results.push({ month, state: "READY_DRY_RUN", bands, monthly, tenants: serviceTargets.map((item) => ({ tenantId: item.tenantId, outcome: "WOULD_PUBLISH_IF_CHANGED" })), errors }); continue; }

      const components: ServiceComponents = { ...(bandsComponent ? { bands: bandsComponent } : {}), ...(monthlyComponent ? { monthly: monthlyComponent } : {}) };
      const values = { ...(bands ? { f1: bands.f1, f2: bands.f2, f3: bands.f3 } : {}), ...(monthly ? { monthly: monthly.value } : {}) };
      const tenants: MonthResult["tenants"][number][] = [];
      for (const tenantId of input.tenants) {
        try { tenants.push({ tenantId, ...(await publishTenant(market, tenantId, month, values, components, input.now)) }); }
        catch (error) { const message = error instanceof Error ? error.message : "PUBLISH_FAILED"; errors.push(`${tenantId}:${message}`); blocking.push(`${tenantId}:${message}`); tenants.push({ tenantId, outcome: `FAILED:${message}` }); }
      }
      const published = tenants.some((item) => item.outcome === "PUBLISHED");
      const missing = [!bands ? "fasce F1, F2, F3" : null, !monthly ? "PUN mensile (newsletter non ancora pubblicata o non verificata)" : null].filter(Boolean).join(" e ");
      const detail = `${bands ? `F1 ${bands.f1} · F2 ${bands.f2} · F3 ${bands.f3} €/MWh (PDF fasce)` : ""}${bands && monthly ? "; " : ""}${monthly ? `mensile ${monthly.value} €/MWh (Newsletter GME n. ${monthly.newsletter ?? "?"})` : ""}${missing ? `; manca: ${missing}` : ""}`;
      let alertId: string | null = null;
      if (blocking.length) alertId = await raiseAnomaly(input.store, "GME_PUN_MONTH", month, `servizio automatico: ${blocking.join("; ")}`, input.now);
      else if (!missing) await resolveAnomaly(input.store, "GME_PUN_MONTH", month, "acquisito e pubblicato dal servizio automatico", input.now);
      await recordCheck(input.store, { code: "GME_PUN_MONTH", period: month, at: input.now, outcome: blocking.length ? "FAILED" : published ? "ACQUIRED" : "COVERED", detail, nextCheckAt: input.nextCheckAt, alertId });
      results.push({ month, state: blocking.length ? "FAILED" : published ? "PUBLISHED" : missing ? "INCOMPLETE" : "UNCHANGED", bands, monthly, tenants, errors });
    } catch (error) {
      results.push({ month, state: "FAILED", bands: null, monthly: null, tenants: [], errors: [...errors, error instanceof Error ? error.message : "GME_JOB_FAILED"] });
    } finally {
      if (punop && results.length > before) results[results.length - 1] = { ...results[results.length - 1], punop };
    }
  }
  return results;
}

/**
 * The three GME publication pages named by Tony (22/11/2026), each with its own meaning. The PUN Index GME page defines the
 * index and prints no value: the monthly PUN Index GME is read from the newsletter (Tabella 1), never derived.
 */
export const GME_SOURCE_PAGES = [
  { id: "GME_PUN_BANDS", url: GME_PUN_BANDS_PUBLICATIONS_PAGE, meaning: "Prezzo medio per fasce F1, F2, F3 (PDF mensile)", marker: /prezzo\s+medio\s+per\s+fasce/i },
  { id: GME_PUNOP_300_SERIES_ID, url: GME_PUNOP_300_PAGE, meaning: GME_PUNOP_300_MEANING, marker: /300\s*\/\s*05/i },
  { id: "GME_PUN_INDEX_GME", url: "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/Indici-GME/PUNIndexGme", meaning: "PUN Index GME: definizione dell'indice; il valore mensile si legge dalla Newsletter GME, Tabella 1", marker: /PUN\s+Index\s+GME/i },
] as const;
export interface SourcePageResult { readonly id: string; readonly url: string; readonly meaning: string; readonly reachable: boolean; readonly sha256: string | null; readonly detail: string }

export async function gmeSourcePages(fetcher: OfficialFetch, recorded: readonly FetchedDocument[]): Promise<readonly SourcePageResult[]> {
  const out: SourcePageResult[] = [];
  for (const page of GME_SOURCE_PAGES) {
    try {
      const document = await fetchDocument(fetcher, page.url, recorded);
      const found = page.marker.test(new TextDecoder().decode(document.bytes));
      out.push({ id: page.id, url: page.url, meaning: page.meaning, reachable: found, sha256: document.sha256, detail: found ? "pagina ufficiale raggiungibile" : "pagina raggiunta ma senza il titolo atteso" });
    } catch (error) {
      out.push({ id: page.id, url: page.url, meaning: page.meaning, reachable: false, sha256: null, detail: `pagina non raggiungibile: ${error instanceof Error ? error.message : "errore"}` });
    }
  }
  return out;
}
