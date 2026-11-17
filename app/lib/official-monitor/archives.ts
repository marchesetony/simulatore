import { OFFICIAL_CATALOG, officialLinkFor, type Acquisition, type OfficialDocumentCode, type OfficialSource } from "./catalog";
import { ALERT_STATUS_LABEL, OFFICIAL_MONITOR_TENANT, type AlertStatus, type OfficialAlert, type OfficialCheck } from "./monitor";
import { PROVENANCE_LABEL, UPLOADABLE_DOCUMENTS, allPublications, documentSummary, type DocumentRepositories, type OfficialDocumentRecord } from "./documents";

/**
 * Control Room Produttore → Archivi ufficiali (Tony, 17/11/2026): una vista per ciascuno dei quattro archivi (ARERA, GME,
 * Terna, ADM) con ultimo aggiornamento, periodo coperto, fonte ufficiale, stato, documenti mancanti, alert e storico delle
 * importazioni. Tutto è letto dai registri già esistenti del monitor (esiti dei controlli, alert, documenti validati,
 * pubblicazioni): nessun archivio parallelo e nessuna copia per azienda.
 */
export const ARCHIVE_SOURCES: readonly OfficialSource[] = ["ARERA", "GME", "TERNA", "ADM"];
export const ARCHIVE_LABEL: Readonly<Record<OfficialSource, string>> = { ARERA: "ARERA", GME: "GME", TERNA: "Terna", ADM: "ADM" };

export type ArchiveStatus = "UP_TO_DATE" | "ACTION_REQUIRED" | "AWAITING_PUBLICATION" | "NEVER_CHECKED";
/** Stato del MONITORAGGIO (controlli eseguiti e pubblicazioni), non della copertura dei dati: quella è in coverage.ts. */
export const ARCHIVE_STATUS_LABEL: Readonly<Record<ArchiveStatus, string>> = {
  UP_TO_DATE: "Monitoraggio regolare",
  ACTION_REQUIRED: "Monitoraggio: azione richiesta",
  AWAITING_PUBLICATION: "Documento validato, da pubblicare",
  NEVER_CHECKED: "Monitoraggio mai eseguito",
};

export interface ArchiveDocumentView {
  readonly code: OfficialDocumentCode;
  readonly document: string;
  readonly acquisition: Acquisition;
  readonly officialLink: string;
  readonly uploadPath: string;
  readonly uploadable: boolean;
  readonly coveredPeriods: readonly string[];
  readonly lastUpdate: string | null;
}
export interface ArchiveHistoryEntry {
  readonly at: string;
  readonly kind: "CHECK" | "VALIDATION" | "PUBLICATION";
  readonly code: OfficialDocumentCode;
  readonly document: string;
  readonly period: string;
  readonly outcome: string;
  readonly detail: string;
  readonly actor: string | null;
  readonly documentId: string | null;
}
export interface ArchiveAlertView extends OfficialAlert { readonly statusLabel: string }
export interface ArchiveView {
  readonly source: OfficialSource;
  readonly label: string;
  readonly status: ArchiveStatus;
  readonly statusLabel: string;
  readonly lastUpdate: string | null;
  readonly periodCovered: string;
  readonly officialLinks: readonly string[];
  readonly missing: readonly { readonly code: OfficialDocumentCode; readonly document: string; readonly period: string; readonly status: AlertStatus; readonly statusLabel: string }[];
  readonly alerts: readonly ArchiveAlertView[];
  readonly documents: readonly ArchiveDocumentView[];
  readonly history: readonly ArchiveHistoryEntry[];
}

const latest = (values: readonly (string | null | undefined)[]) => values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
const OK_CHECK = new Set(["COVERED", "ACQUIRED"]);

export async function archiveOverview(repositories: DocumentRepositories, historyLimit = 40): Promise<readonly ArchiveView[]> {
  const alerts = (await repositories.alerts.list(OFFICIAL_MONITOR_TENANT)).map((record) => record.payload as OfficialAlert);
  const checks = (await repositories.checks.list(OFFICIAL_MONITOR_TENANT)).map((record) => record.payload as OfficialCheck);
  const documents = (await repositories.documents.list(OFFICIAL_MONITOR_TENANT)).map((record) => record.payload as OfficialDocumentRecord);
  const publications = await allPublications(repositories.publications);
  return ARCHIVE_SOURCES.map((source) => {
    const entries = OFFICIAL_CATALOG.filter((entry) => entry.source === source);
    const codes = new Set(entries.map((entry) => entry.code));
    const own = <T extends { readonly code: OfficialDocumentCode }>(items: readonly T[]) => items.filter((item) => codes.has(item.code));
    const sourceAlerts = own(alerts).sort((a, b) => b.lastCheckedAt.localeCompare(a.lastCheckedAt));
    const sourceChecks = own(checks);
    const sourceDocuments = own(documents);
    const sourcePublications = own(publications);
    const docViews: ArchiveDocumentView[] = entries.map((entry) => {
      const published = sourcePublications.filter((item) => item.code === entry.code);
      const okChecks = sourceChecks.filter((item) => item.code === entry.code && OK_CHECK.has(item.outcome));
      const resolvedManual = entry.acquisition === "MANUAL_VERIFICATION" ? sourceAlerts.filter((item) => item.code === entry.code && item.status === "RESOLVED") : [];
      const coveredPeriods = [...new Set([...published.map((item) => item.period), ...okChecks.map((item) => item.period), ...resolvedManual.map((item) => item.period)])].sort();
      return {
        code: entry.code, document: entry.document, acquisition: entry.acquisition, officialLink: entry.linkByPeriod ? officialLinkFor(entry, coveredPeriods.at(-1) ?? "") : entry.officialLink,
        uploadPath: entry.uploadPath, uploadable: UPLOADABLE_DOCUMENTS.includes(entry.code), coveredPeriods,
        lastUpdate: latest([...published.map((item) => item.publishedAt), ...okChecks.map((item) => item.at), ...resolvedManual.map((item) => item.lastCheckedAt)]),
      };
    });
    const open = sourceAlerts.filter((alert) => alert.status !== "RESOLVED");
    const name = (code: OfficialDocumentCode) => entries.find((entry) => entry.code === code)?.document ?? code;
    const history: ArchiveHistoryEntry[] = [
      ...sourceChecks.map((item) => ({ at: item.at, kind: "CHECK" as const, code: item.code, document: name(item.code), period: item.period, outcome: item.outcome, detail: item.detail, actor: null, documentId: null })),
      ...sourceDocuments.map((item) => ({ at: item.uploadedAt, kind: "VALIDATION" as const, code: item.code, document: name(item.code), period: item.period, outcome: item.status, detail: `${item.originalName} v${item.version}, SHA-256 ${item.sha256}; provenienza: ${PROVENANCE_LABEL[item.provenance.level]}${item.provenance.officialSha256 ? `; riferimento ufficiale SHA-256 ${item.provenance.officialSha256}` : ""}`, actor: item.uploadedBy, documentId: item.documentId })),
      ...sourcePublications.map((item) => ({ at: item.publishedAt, kind: "PUBLICATION" as const, code: item.code, document: name(item.code), period: item.period, outcome: "PUBLISHED", detail: `v${item.version}, SHA-256 ${item.sha256}${item.supersedes ? ", sostituisce la pubblicazione precedente" : ""}${item.provenanceAcknowledged ? "; provenienza non verificata (dichiarata o da verificare), accettata esplicitamente" : ""}`, actor: item.publishedBy, documentId: item.documentId })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, historyLimit);
    const status: ArchiveStatus = open.some((alert) => alert.status !== "FILE_UPLOADED") ? "ACTION_REQUIRED"
      : open.length ? "AWAITING_PUBLICATION"
      : sourceChecks.length || sourcePublications.length ? "UP_TO_DATE" : "NEVER_CHECKED";
    const allCovered = docViews.flatMap((view) => view.coveredPeriods).sort();
    return {
      source, label: ARCHIVE_LABEL[source], status, statusLabel: ARCHIVE_STATUS_LABEL[status],
      lastUpdate: latest(docViews.map((view) => view.lastUpdate)),
      periodCovered: allCovered.length ? (allCovered[0] === allCovered.at(-1) ? allCovered[0] : `${allCovered[0]} – ${allCovered.at(-1)}`) : "nessun periodo coperto",
      officialLinks: [...new Set(docViews.map((view) => view.officialLink))],
      missing: open.map((alert) => ({ code: alert.code, document: alert.document, period: alert.period, status: alert.status, statusLabel: ALERT_STATUS_LABEL[alert.status] })),
      alerts: sourceAlerts.map((alert) => ({ ...alert, statusLabel: ALERT_STATUS_LABEL[alert.status] })),
      documents: docViews, history,
    };
  });
}

/** Documents of the archive with their preview, without the original bytes. */
export function documentPreview(record: OfficialDocumentRecord) {
  return { ...documentSummary(record), provenanceLabel: PROVENANCE_LABEL[record.provenance.level] };
}
