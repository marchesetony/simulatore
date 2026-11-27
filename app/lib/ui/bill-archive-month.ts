/**
 * Tony (20/11/2026, "AVVIO FASE 2: ARCHIVIO BOLLETTE"): the company's bill archive, ordered by month, searchable and
 * manageable. A bill is filed once, under the month its consumption period ends; the month filter also finds it in the other
 * months the period covers, without a second copy. Missing data is shown as missing, never guessed. No imports: the screen
 * and the server use the same rules.
 */

export type BillArchiveReadingState = "APPROVED" | "TO_COMPLETE" | "READ_FAILED";
/**
 * Tony (20/11/2026, "CHIUSURA FASE 2", punto 2): the kind of document recognized from its content.
 * SUMMARY sintetica; DETAIL dettagliata (also when it is the only PDF); SUMMARY_WITH_DETAIL sintetica with its dettagliata
 * linked and verified; COMPLETE one PDF holding both; UNKNOWN not recognized (read before 20/11/2026 or reading failed).
 */
export type BillArchiveDocumentKind = "SUMMARY" | "DETAIL" | "SUMMARY_WITH_DETAIL" | "COMPLETE" | "UNKNOWN";
export type BillArchiveDocumentFilter = "ALL" | BillArchiveDocumentKind;
export const DOCUMENT_KIND_LABEL: Readonly<Record<BillArchiveDocumentKind, string>> = { SUMMARY: "Sintetica", DETAIL: "Dettagliata", SUMMARY_WITH_DETAIL: "Sintetica e dettagliata collegate", COMPLETE: "Sintetica e dettagliata nello stesso PDF", UNKNOWN: "Tipo non rilevato" };

/** The archive's kind from the stored reading: a linked dettagliata wins; otherwise the kind read from the content. */
export function documentKindOf(documentType: string | null | undefined, detailLinked: boolean): BillArchiveDocumentKind {
  if (detailLinked) return "SUMMARY_WITH_DETAIL";
  return documentType === "BOLLETTA_SINTETICA" ? "SUMMARY" : documentType === "FATTURA_DETTAGLIO" ? "DETAIL" : documentType === "BOLLETTA_COMPLETA" ? "COMPLETE" : "UNKNOWN";
}

/** One invoice of the archive, as GET /api/bills/archive returns it: null wherever the reading has no value. */
export interface BillArchiveRow {
  readonly id: string;
  readonly customerName: string | null;
  readonly pod: string | null;
  readonly supplier: string | null;
  readonly invoiceNumber: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  /** "YYYY-MM" of the period end; null when the period end was not read. */
  readonly archiveMonth: string | null;
  /** Every month the consumption period touches, archive month included ("YYYY-MM", ascending). */
  readonly competenceMonths: readonly string[];
  /** The total as printed on the bill (original document), never recalculated. */
  readonly totalAmount: string | null;
  readonly readingState: BillArchiveReadingState;
  readonly documentKind: BillArchiveDocumentKind;
  /** Tony (20/11/2026, punto 1): whether the bill can still be quoted today (simulation window); the archive keeps it either way. */
  readonly simulable: boolean;
  readonly linkedProposals: number;
  readonly uploadedAt: string;
}

export const NOT_AVAILABLE = "Non disponibile";
export const NO_MONTH = "Periodo non letto";
const READING_LABEL: Readonly<Record<BillArchiveReadingState, string>> = { APPROVED: "Approvata", TO_COMPLETE: "Da completare", READ_FAILED: "Lettura non riuscita" };
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

function isoDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? "");
  if (!match) return null;
  const month = Number(match[2]); const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function monthOf(date: string | null | undefined): string | null { const iso = isoDate(date); return iso ? iso.slice(0, 7) : null; }

/** Months from the start's to the end's, both included; only the end's month when the start is missing or after the end. */
export function competenceMonths(periodStart: string | null | undefined, periodEnd: string | null | undefined): readonly string[] {
  const end = monthOf(periodEnd);
  if (!end) return [];
  const start = monthOf(periodStart);
  if (!start || start > end) return [end];
  const months: string[] = [];
  let [year, month] = start.split("-").map(Number);
  // A bound on the span keeps a misread year from producing hundreds of months.
  while (months.length < 36) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key === end) break;
    month += 1; if (month > 12) { month = 1; year += 1; }
  }
  return months.at(-1) === end ? months : [end];
}

export function monthLabel(month: string | null): string {
  if (!month) return NO_MONTH;
  const [year, number] = month.split("-");
  const name = MONTHS[Number(number) - 1];
  return name ? `${name[0].toUpperCase()}${name.slice(1)} ${year}` : month;
}

function italianDate(iso: string): string { return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`; }

export function periodText(row: Pick<BillArchiveRow, "periodStart" | "periodEnd">): string {
  const start = isoDate(row.periodStart); const end = isoDate(row.periodEnd);
  if (start && end) return `${italianDate(start)} - ${italianDate(end)}`;
  if (end) return `fino al ${italianDate(end)}`;
  return NOT_AVAILABLE;
}

/** The printed total in euro when it is a number, otherwise as printed; "Non disponibile" when it was not read. */
export function totalText(total: string | null): string {
  const value = total?.trim();
  if (!value) return NOT_AVAILABLE;
  const compact = value.replace(/[€\s]/g, "");
  const normalized = /,\d{1,2}$/.test(compact) ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "");
  const amount = Number(normalized);
  if (!/^-?\d+(\.\d+)?$/.test(normalized) || !Number.isFinite(amount)) return value;
  // Same text on server and browser, whatever their locale data: thousands with ".", decimals with ",".
  const [whole, cents] = Math.abs(amount).toFixed(2).split(".");
  return `${amount < 0 ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${cents} €`;
}

export function readingLabel(state: BillArchiveReadingState): string { return READING_LABEL[state]; }

export function documentsText(kind: BillArchiveDocumentKind): string { return DOCUMENT_KIND_LABEL[kind] ?? DOCUMENT_KIND_LABEL.UNKNOWN; }

export function simulableText(simulable: boolean): string { return simulable ? "Simulabile" : "Fuori dalla finestra di simulazione (resta in archivio)"; }

export function proposalsText(count: number): string { return count === 0 ? "Nessuna proposta" : count === 1 ? "1 proposta collegata" : `${count} proposte collegate`; }

export function isMultiMonth(row: Pick<BillArchiveRow, "competenceMonths">): boolean { return row.competenceMonths.length > 1; }

export interface BillArchiveFilter {
  /** Customer, POD or invoice number (every word typed must match one of them). */
  readonly query?: string;
  /** "YYYY-MM": bills whose consumption period touches the month, filed there or elsewhere. */
  readonly month?: string | null;
  /** Consumption period overlapping [periodFrom, periodTo] ("YYYY-MM-DD", either may be empty). */
  readonly periodFrom?: string | null;
  readonly periodTo?: string | null;
  readonly documents?: BillArchiveDocumentFilter;
}

function normalizedText(value: string): string { return value.toLocaleLowerCase("it").replace(/\s+/g, ""); }

export function filterArchiveRows(rows: readonly BillArchiveRow[], filter: BillArchiveFilter): readonly BillArchiveRow[] {
  const words = (filter.query ?? "").toLocaleLowerCase("it").split(/\s+/).filter(Boolean);
  const from = isoDate(filter.periodFrom); const to = isoDate(filter.periodTo);
  return rows.filter((row) => {
    if (words.length) {
      const haystack = [row.customerName ?? "", row.pod ?? "", row.invoiceNumber ?? ""].join(" ").toLocaleLowerCase("it");
      const compact = normalizedText([row.pod ?? "", row.invoiceNumber ?? ""].join("|"));
      if (!words.every((word) => haystack.includes(word) || compact.includes(normalizedText(word)))) return false;
    }
    if (filter.month && !row.competenceMonths.includes(filter.month)) return false;
    if (from || to) {
      const start = isoDate(row.periodStart) ?? isoDate(row.periodEnd); const end = isoDate(row.periodEnd);
      // A bill without a read period cannot be placed in a period: it is not shown as if it matched.
      if (!start || !end) return false;
      if (from && end < from) return false;
      if (to && start > to) return false;
    }
    if (filter.documents && filter.documents !== "ALL" && row.documentKind !== filter.documents) return false;
    return true;
  });
}

export interface BillArchiveMonthGroup { readonly month: string | null; readonly label: string; readonly rows: readonly BillArchiveRow[] }

/**
 * Groups for the screen, newest month first, bills without a read period last. With a month filter every bill found is shown
 * under that month (filed there or, for a multi-month bill, filed under its end month and found here); otherwise each bill
 * appears once, under its archive month.
 */
export function groupArchiveRows(rows: readonly BillArchiveRow[], monthFilter?: string | null): readonly BillArchiveMonthGroup[] {
  const byMonth = new Map<string | null, BillArchiveRow[]>();
  for (const row of rows) { const key = monthFilter ? monthFilter : row.archiveMonth; byMonth.set(key, [...(byMonth.get(key) ?? []), row]); }
  return [...byMonth.entries()]
    .sort(([left], [right]) => left === null ? 1 : right === null ? -1 : right.localeCompare(left))
    .map(([month, items]) => ({ month, label: monthLabel(month), rows: items.slice().sort((a, b) => (a.customerName ?? "￿").localeCompare(b.customerName ?? "￿", "it", { sensitivity: "base" }) || (a.periodEnd ?? "").localeCompare(b.periodEnd ?? "") || a.id.localeCompare(b.id)) }));
}

/** The months to offer in the filter: every month some bill covers, newest first. */
export function archiveMonths(rows: readonly BillArchiveRow[]): readonly string[] {
  return [...new Set(rows.flatMap((row) => row.competenceMonths))].sort((a, b) => b.localeCompare(a));
}

// Deletion (Tony 20/11/2026, point 4): one server call for the selection, the real outcome of every bill.
export type BillBulkOutcome = "DELETED" | "NOT_FOUND" | "FORBIDDEN" | "LINKED_TO_PROPOSALS" | "NOT_COMPLETED";
export interface BillBulkResult { readonly id: string; readonly outcome: BillBulkOutcome; readonly linkedProposals?: number }
export const BULK_DELETE_LIMIT = 100;

export function bulkOutcomeText(result: BillBulkResult): string {
  switch (result.outcome) {
    case "DELETED": return "eliminata, con la fattura di dettaglio e i dati collegati";
    case "NOT_FOUND": return "non trovata (forse già eliminata)";
    case "FORBIDDEN": return "non eliminata: fuori dal tuo ramo commerciale";
    case "LINKED_TO_PROPOSALS": return `non eliminata: ha ${proposalsText(result.linkedProposals ?? 0).replace("Nessuna proposta", "proposte collegate")}. Elimina prima le proposte dalla sezione «Proposte»`;
    default: return "non completata: errore durante l'eliminazione, riprova (la bolletta resta in archivio)";
  }
}

export function bulkSummaryText(results: readonly BillBulkResult[]): string {
  const deleted = results.filter((item) => item.outcome === "DELETED").length;
  const blocked = results.filter((item) => item.outcome === "LINKED_TO_PROPOSALS" || item.outcome === "FORBIDDEN").length;
  const other = results.length - deleted - blocked;
  const parts = [deleted === 1 ? "1 eliminata" : `${deleted} eliminate`, ...(blocked ? [blocked === 1 ? "1 bloccata" : `${blocked} bloccate`] : []), ...(other ? [other === 1 ? "1 non eliminata per altri motivi" : `${other} non eliminate per altri motivi`] : [])];
  return `Esito su ${results.length === 1 ? "1 bolletta" : `${results.length} bollette`}: ${parts.join(", ")}.`;
}

/** What the confirmation says before anything is deleted: how many will go and which ones the server will keep. */
export function bulkConfirmText(rows: readonly Pick<BillArchiveRow, "linkedProposals">[]): string {
  const blocked = rows.filter((row) => row.linkedProposals > 0).length;
  const deletable = rows.length - blocked;
  const head = deletable === 1 ? "Eliminare definitivamente 1 bolletta" : `Eliminare definitivamente ${deletable} bollette`;
  const tail = blocked ? ` ${blocked === 1 ? "1 bolletta selezionata ha" : `${blocked} bollette selezionate hanno`} proposte collegate e non verrà eliminata.` : "";
  return `${head}, con le fatture di dettaglio collegate e i dati estratti? L'operazione non si può annullare.${tail}`;
}
