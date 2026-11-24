import { createHash } from "node:crypto";
import type { ElectricityMonthlyPunRecord } from "../../../../app/lib/energy/market-data";
import { compareMarketVersions } from "../../../../app/lib/market/service";
import type { ServiceStore } from "../store";
import type { FetchedDocument, OfficialFetch } from "../official-fetch";
import { PLATFORM_TENANT, conserveDocument } from "../documents";
import { raiseAnomaly, type ServiceMode } from "../status";
import { SERVICE_ACTOR } from "../identity";
import { GME_NEWSLETTER_SOURCE_ID, newsletterCandidates, readNewsletterPdf } from "./newsletter";
import { readGmeBandsPdf } from "../../../../app/lib/official-monitor/gme-pun-bands";
import { GME_PUN_BANDS_PUBLICATIONS_PAGE } from "../../../../app/lib/market/gme-pun-source";
import { findGmeMonthlyBandsPdf } from "../../../../app/lib/market/gme-monthly-bands";

/**
 * Tony (21/11/2026, decisione 4): June–October 2026 are not changed now. The audit compares, for every company, the approved
 * monthly value and bands of each month with the GME publications (newsletter Tabella 1 for the monthly value, "Prezzo medio
 * per fasce" PDF for the bands), at the two decimals GME prints. A difference is never corrected silently: it is recorded,
 * signalled in the Control Room, and the verified version is prepared inside the audit record (values + documents) for the
 * producer's decision. Nothing is written to the PUN archive.
 */
export interface AuditFinding {
  readonly tenantId: string;
  readonly archiveId: string;
  readonly version: string;
  readonly field: "monthly" | "f1" | "f2" | "f3";
  readonly archived: number | null;
  readonly official: number | null;
  readonly outcome: "MATCH" | "DIVERGENT" | "OFFICIAL_MISSING" | "ARCHIVE_MISSING";
}
export interface PunAuditRecord {
  readonly auditId: string;
  readonly month: string;
  readonly at: string;
  readonly by: string;
  readonly outcome: "MATCH" | "DIVERGENT" | "INCOMPLETE";
  readonly official: { readonly monthly: number | null; readonly newsletter: string | null; readonly newsletterUrl: string | null; readonly newsletterSha256: string | null; readonly f1: number | null; readonly f2: number | null; readonly f3: number | null; readonly bandsUrl: string | null; readonly bandsSha256: string | null };
  readonly findings: readonly AuditFinding[];
  /** The verified version to propose when something differs: official values only, never written to the archive here. */
  readonly preparedVersion: { readonly month: string; readonly monthly: number | null; readonly f1: number | null; readonly f2: number | null; readonly f3: number | null; readonly sources: readonly string[] } | null;
  readonly errors: readonly string[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

async function acquire(fetcher: OfficialFetch, recorded: readonly FetchedDocument[], url: string): Promise<FetchedDocument | null> {
  try {
    const response = await fetcher(url);
    if (!response.ok) return null;
    return [...recorded].reverse().find((item) => item.url === url) ?? null;
  } catch { return null; }
}

export async function runPunAudit(input: { readonly store: ServiceStore; readonly fetcher: OfficialFetch; readonly recorded: readonly FetchedDocument[]; readonly tenants: readonly string[]; readonly months: readonly string[]; readonly now: string; readonly mode: ServiceMode }): Promise<readonly PunAuditRecord[]> {
  const market = input.store.market();
  const out: PunAuditRecord[] = [];
  let pageHtml: string | null = null;
  for (const month of input.months) {
    const errors: string[] = [];
    // Official monthly value: the newsletter that reports on the month.
    let monthly: number | null = null; let newsletter: string | null = null; let newsletterDoc: FetchedDocument | null = null;
    for (const url of newsletterCandidates(month)) {
      const head = await input.fetcher(url, { method: "HEAD" }).catch(() => null);
      if (!head?.ok || !/pdf/i.test(head.headers.get("content-type") ?? "")) continue;
      const document = await acquire(input.fetcher, input.recorded, url);
      if (!document) continue;
      const reading = await readNewsletterPdf(document.bytes, month);
      if (reading.checks.find((check) => check.code === "REPORT_MONTH")?.ok === false) continue;
      if (reading.monthly === null) { errors.push(`NEWSLETTER_CHECKS:${reading.checks.filter((check) => !check.ok).map((check) => check.code).join(",")}`); break; }
      monthly = reading.monthly; newsletter = reading.number; newsletterDoc = document;
      if (input.mode === "PUBLISH") await conserveDocument(input.store, { document, kind: "GME_NEWSLETTER_PDF", source: "GME", period: month, checks: reading.checks, values: { monthly, newsletter: reading.number, unit: "EUR_PER_MWH" } });
      break;
    }
    if (monthly === null && !errors.length) errors.push("NEWSLETTER_NOT_FOUND");
    // Official bands: the PDF of the month.
    let bands: { f1: number; f2: number; f3: number } | null = null; let bandsDoc: FetchedDocument | null = null;
    try {
      pageHtml ??= new TextDecoder().decode((await acquire(input.fetcher, input.recorded, GME_PUN_BANDS_PUBLICATIONS_PAGE))?.bytes ?? new Uint8Array());
      const url = findGmeMonthlyBandsPdf(pageHtml, month);
      bandsDoc = await acquire(input.fetcher, input.recorded, url);
      if (bandsDoc) {
        // The audit reads documents of months that may already be outside the window: the window check does not apply here.
        const reading = readGmeBandsPdf(bandsDoc.bytes, month, `${month}-15T12:00:00.000Z`);
        const failed = reading.checks.filter((check) => !check.ok && check.code !== "OPERATIONAL_WINDOW");
        if (reading.values && !failed.length) {
          bands = { f1: reading.values.f1, f2: reading.values.f2, f3: reading.values.f3 };
          if (input.mode === "PUBLISH") await conserveDocument(input.store, { document: bandsDoc, kind: "GME_PUN_BANDS_PDF", source: "GME", period: month, checks: reading.checks, values: { ...bands, hours: [...reading.values.hours], unit: "EUR_PER_MWH" } });
        } else errors.push(`BANDS_CHECKS:${failed.map((check) => check.code).join(",")}`);
      } else errors.push("BANDS_PDF_UNREACHABLE");
    } catch (error) { errors.push(`BANDS:${error instanceof Error ? error.message : "errore"}`); }

    const findings: AuditFinding[] = [];
    for (const tenantId of input.tenants) {
      const current = (await market.list(tenantId)).filter((record) => record.vector === "EE" && record.index === "PUN" && record.month === month && record.status === "APPROVED").sort(compareMarketVersions)[0];
      if (!current) continue;
      const record = current.record as ElectricityMonthlyPunRecord;
      const official = { monthly, f1: bands?.f1 ?? null, f2: bands?.f2 ?? null, f3: bands?.f3 ?? null };
      for (const field of ["monthly", "f1", "f2", "f3"] as const) {
        const archived = record[field]?.value ?? null;
        const value = official[field];
        const outcome: AuditFinding["outcome"] = value === null ? "OFFICIAL_MISSING" : archived === null ? "ARCHIVE_MISSING" : round2(archived) === value ? "MATCH" : "DIVERGENT";
        findings.push({ tenantId, archiveId: current.archiveId, version: current.record.version, field, archived, official: value, outcome });
      }
    }
    const divergent = findings.some((finding) => finding.outcome === "DIVERGENT" || finding.outcome === "ARCHIVE_MISSING");
    const complete = monthly !== null && bands !== null;
    const outcome: PunAuditRecord["outcome"] = divergent ? "DIVERGENT" : complete ? "MATCH" : "INCOMPLETE";
    const auditId = `svcaudit_pun_${month}_${createHash("sha256").update(`${month}|${input.now}`).digest("hex").slice(0, 16)}`;
    const record: PunAuditRecord = {
      auditId, month, at: input.now, by: SERVICE_ACTOR, outcome,
      official: { monthly, newsletter, newsletterUrl: newsletterDoc?.url ?? null, newsletterSha256: newsletterDoc?.sha256 ?? null, f1: bands?.f1 ?? null, f2: bands?.f2 ?? null, f3: bands?.f3 ?? null, bandsUrl: bandsDoc?.url ?? null, bandsSha256: bandsDoc?.sha256 ?? null },
      findings,
      preparedVersion: divergent ? { month, monthly, f1: bands?.f1 ?? null, f2: bands?.f2 ?? null, f3: bands?.f3 ?? null, sources: [newsletterDoc ? `${GME_NEWSLETTER_SOURCE_ID} ${newsletterDoc.url} sha256 ${newsletterDoc.sha256}` : "", bandsDoc ? `GME_PREZZO_MEDIO_FASCE ${bandsDoc.url} sha256 ${bandsDoc.sha256}` : ""].filter(Boolean) } : null,
      errors,
    };
    if (input.mode === "PUBLISH") {
      await input.store.writable<PunAuditRecord>("official-service-audits").append({ tenantId: PLATFORM_TENANT, recordId: auditId, payload: record, idempotencyKey: auditId, now: input.now });
      if (divergent) await raiseAnomaly(input.store, "GME_PUN_MONTH", month, `audit PUN: valori archiviati diversi dalle pubblicazioni GME (${findings.filter((finding) => finding.outcome !== "MATCH" && finding.outcome !== "OFFICIAL_MISSING").map((finding) => `${finding.tenantId} ${finding.field} ${finding.archived ?? "assente"} ≠ ${finding.official}`).join("; ")}); versione verificata preparata nell'audit, nessuna correzione automatica`, input.now);
    }
    out.push(record);
  }
  return out;
}
