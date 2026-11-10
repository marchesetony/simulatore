import type { ApprovedBillSummaryModel, BillDocumentModel } from "./models";

// Tony (10/11/2026): "Nuova simulazione" lists the bills already uploaded in two groups, "Bollette da completare" (not yet
// approved: they open on "Dati letti" to finish the review, never straight to the offers) and "Bollette già disponibili"
// (approved, reusable). Each row shows holder, POD, billed period and state. The server already filters by tenant and
// commercial branch and refuses lists over its limit, so a list is either complete or replaced by an explicit message.

export type BillArchiveState = "TO_COMPLETE" | "READ_FAILED" | "APPROVED";

export interface BillArchiveEntry {
  readonly id: string;
  readonly holder: string;
  readonly pod: string;
  readonly period: string;
  readonly supplier: string | null;
  /** As printed, when the reading has it (bills to complete); the approved summary does not carry it. */
  readonly invoiceNumber: string | null;
  /** First characters of the archive ID: tells apart two uploads of the same invoice. */
  readonly shortId: string;
  readonly state: BillArchiveState;
  readonly stateLabel: string;
  /** False when the stored reading failed: there is nothing to review, the PDF must be uploaded again. */
  readonly openable: boolean;
}

export const BILL_LIST_LIMIT = 100;
const NOT_READ = "Non letto";
const STATE_LABEL: Readonly<Record<BillArchiveState, string>> = { TO_COMPLETE: "Da completare", READ_FAILED: "Lettura non riuscita", APPROVED: "Approvata" };
const FAILED_STATUSES = new Set(["FAILED", "OCR_PROVIDER_REQUIRED", "PROVIDER_NOT_CONFIGURED"]);

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function shortArchiveId(id: string): string { return id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || id.slice(0, 8); }

function italianDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

/** The billed period as dd/mm/yyyy - dd/mm/yyyy when both ends are known, otherwise as read. */
export function periodLabel(start: string | null | undefined, end: string | null | undefined, raw?: string | null): string {
  if (text(start) && text(end)) return `${italianDate(start as string)} - ${italianDate(end as string)}`;
  const value = text(raw);
  if (!value) return NOT_READ;
  const dates = [...value.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((match) => match[0]);
  return dates.length >= 2 ? `${italianDate(dates[0])} - ${italianDate(dates[dates.length - 1])}` : value;
}

/** A bill not yet approved, as returned by GET /api/bills (no view). */
export function pendingBillEntry(bill: BillDocumentModel): BillArchiveEntry {
  const failed = FAILED_STATUSES.has(bill.status);
  const state: BillArchiveState = failed ? "READ_FAILED" : "TO_COMPLETE";
  const normalized = bill.normalized;
  return {
    id: bill.id,
    holder: text(bill.fields.customerName?.value) ?? text(normalized?.customer.name) ?? text(bill.fileName) ?? NOT_READ,
    pod: text(bill.fields.pod?.value) ?? text(normalized?.supply.reference) ?? NOT_READ,
    period: periodLabel(normalized?.billingPeriod.periodStart, normalized?.billingPeriod.periodEnd, bill.fields.billingPeriod?.value),
    supplier: text(bill.fields.supplier?.value) ?? text(normalized?.currentSupplier),
    invoiceNumber: text(bill.analystReview?.receipt?.invoiceNumber?.value ?? null),
    shortId: shortArchiveId(bill.id),
    state,
    stateLabel: STATE_LABEL[state],
    openable: !failed,
  };
}

/** An approved bill, as returned by GET /api/bills?view=approved. */
export function approvedBillEntry(bill: ApprovedBillSummaryModel): BillArchiveEntry {
  return {
    id: bill.id,
    holder: text(bill.title) ?? NOT_READ,
    pod: text(bill.supplyReference) ?? NOT_READ,
    period: periodLabel(bill.period.periodStart, bill.period.periodEnd),
    supplier: text(bill.supplier),
    invoiceNumber: null,
    shortId: shortArchiveId(bill.id),
    state: "APPROVED",
    stateLabel: STATE_LABEL.APPROVED,
    openable: true,
  };
}

export function archiveEntryLabel(entry: BillArchiveEntry): string {
  return [entry.holder, `POD ${entry.pod}`, entry.period, ...(entry.invoiceNumber ? [`Fattura ${entry.invoiceNumber}`] : []), `ID ${entry.shortId}`, entry.stateLabel].join(" · ");
}

/** Entries matching every word typed (holder, POD, period, supplier, state), A to Z by holder. */
export function searchArchive(entries: readonly BillArchiveEntry[], query: string): readonly BillArchiveEntry[] {
  const words = query.toLocaleLowerCase("it").split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => { const haystack = [entry.holder, entry.pod, entry.period, entry.supplier ?? "", entry.invoiceNumber ?? "", entry.shortId, entry.stateLabel].join(" ").toLocaleLowerCase("it"); return words.every((word) => haystack.includes(word)); })
    .slice()
    .sort((a, b) => a.holder.localeCompare(b.holder, "it", { sensitivity: "base" }) || a.period.localeCompare(b.period, "it") || a.id.localeCompare(b.id));
}

/** What the operator reads when a list cannot be shown: never an empty or partial list in its place. */
export function archiveLoadError(code: string | null): string {
  if (code === "BILL_LIST_TOO_LARGE") return `Le bollette accessibili superano il limite di ${BILL_LIST_LIMIT}: l'elenco non viene mostrato per non presentarlo incompleto. Cancella le bollette non più necessarie o carica di nuovo il PDF.`;
  return "Elenco delle bollette non disponibile: riprova. Le bollette salvate non sono state modificate.";
}

export type ArchiveList =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly entries: readonly BillArchiveEntry[] };

// Tony (10/11/2026): selective deletion. Only roles the server lets delete (WRITE: authorization.ts) see the controls; each
// selected bill goes through DELETE /api/bills/[id], which checks tenant, branch and linked proposals for that document,
// and the outcome of every document is reported. "Cancella tutte" is not used.

/** Mirrors the server rule (`can(role, "WRITE")`): company administrator and director / area manager; never an agent. */
export function canDeleteBills(role: string | null | undefined): boolean { return role === "ADMIN" || role === "ANALYST"; }

export type BillDeleteResult = "DELETED" | "NOT_FOUND" | "FORBIDDEN" | "LINKED_TO_PROPOSALS" | "NOT_AUTHORIZED" | "ERROR";
const RESULT_BY_CODE: Readonly<Record<string, BillDeleteResult>> = {
  DOCUMENT_NOT_FOUND: "NOT_FOUND", BILL_DELETE_FORBIDDEN: "FORBIDDEN", BILL_LINKED_TO_PROPOSALS: "LINKED_TO_PROPOSALS",
  AUTHORIZATION_DENIED: "NOT_AUTHORIZED", ROLE_INSUFFICIENT: "NOT_AUTHORIZED", TENANT_ACCESS_DENIED: "NOT_AUTHORIZED",
};
export const DELETE_RESULT_LABEL: Readonly<Record<BillDeleteResult, string>> = {
  DELETED: "cancellata",
  NOT_FOUND: "non trovata (forse già cancellata)",
  FORBIDDEN: "non cancellata: fuori dal tuo ramo commerciale",
  LINKED_TO_PROPOSALS: "non cancellata: ha proposte collegate. Elimina prima le proposte dalla sezione «Proposte», poi cancella la bolletta",
  NOT_AUTHORIZED: "non cancellata: il tuo ruolo non è abilitato",
  ERROR: "non cancellata: errore, riprova",
};

/** The server's answer for one document: success only when it says the document was deleted. */
export function deleteResultOf(response: unknown, error: unknown): BillDeleteResult {
  if (error !== null && error !== undefined) {
    const code = typeof error === "object" && typeof (error as { readonly code?: unknown }).code === "string" ? (error as { readonly code: string }).code : "";
    return RESULT_BY_CODE[code] ?? "ERROR";
  }
  const body = response as { readonly deleted?: unknown; readonly outcome?: unknown } | null;
  return body?.deleted === true && body.outcome === "DELETED" ? "DELETED" : "ERROR";
}

export interface BillDeleteReport { readonly id: string; readonly label: string; readonly result: BillDeleteResult; readonly linkedProposals?: number }

/** Tony (10/11/2026, opzione C): a bill with proposals is never deleted with them; the server answers 409 with their number. */
export function deleteReportText(report: BillDeleteReport): string {
  if (report.result !== "LINKED_TO_PROPOSALS") return DELETE_RESULT_LABEL[report.result];
  const count = report.linkedProposals ?? 0;
  const proposals = count === 1 ? "1 proposta collegata" : count > 1 ? `${count} proposte collegate` : "proposte collegate";
  return `non cancellata: ha ${proposals}. Elimina prima ${count === 1 ? "la proposta" : "le proposte"} dalla sezione «Proposte», poi cancella la bolletta`;
}

/** Error of DELETE /api/bills/[id]: the server code plus, for 409, the number of linked proposals it reported. */
export class BillDeleteError extends Error {
  readonly code: string; readonly linkedProposals: number | null;
  constructor(code: string, linkedProposals: number | null) { super(code); this.name = "BillDeleteError"; this.code = code; this.linkedProposals = linkedProposals; }
}

/** One DELETE /api/bills/[id] (the existing endpoint), keeping the count of linked proposals that requestJson would drop. */
export async function requestBillDelete(id: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const response = await fetchImpl(`/api/bills/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  const item = (body ?? {}) as { readonly linkedProposals?: unknown; readonly error?: { readonly code?: unknown } };
  const code = typeof item.error?.code === "string" && /^[A-Z][A-Z0-9_]{0,80}$/.test(item.error.code) ? item.error.code : `HTTP_${response.status}`;
  const linked = typeof item.linkedProposals === "number" && Number.isInteger(item.linkedProposals) && item.linkedProposals > 0 ? item.linkedProposals : null;
  throw new BillDeleteError(code, linked);
}

/** Deletes the selected bills one by one through the single-document endpoint; one failure does not stop the others. */
export async function deleteSelectedBills(entries: readonly BillArchiveEntry[], deleteOne: (id: string) => Promise<unknown>): Promise<readonly BillDeleteReport[]> {
  const reports: BillDeleteReport[] = [];
  for (const entry of entries) {
    let result: BillDeleteResult; let linkedProposals: number | undefined;
    try { result = deleteResultOf(await deleteOne(entry.id), null); } catch (error) {
      result = deleteResultOf(null, error ?? new Error("UNKNOWN"));
      if (result === "LINKED_TO_PROPOSALS" && error instanceof BillDeleteError && error.linkedProposals !== null) linkedProposals = error.linkedProposals;
    }
    reports.push({ id: entry.id, label: archiveEntryLabel(entry), result, ...(linkedProposals !== undefined ? { linkedProposals } : {}) });
  }
  return reports;
}

export function deleteConfirmText(count: number): string {
  return count === 1 ? "Cancellare definitivamente 1 bolletta selezionata? L'operazione non si può annullare." : `Cancellare definitivamente ${count} bollette selezionate? L'operazione non si può annullare.`;
}

export function deleteSummaryText(reports: readonly BillDeleteReport[]): string {
  const deleted = reports.filter((report) => report.result === "DELETED").length;
  const kept = reports.length - deleted;
  if (!kept) return deleted === 1 ? "1 bolletta cancellata." : `${deleted} bollette cancellate.`;
  return `${deleted} di ${reports.length} bollette cancellate; ${kept} non cancellate: vedi il dettaglio.`;
}
