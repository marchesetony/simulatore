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
    state: "APPROVED",
    stateLabel: STATE_LABEL.APPROVED,
    openable: true,
  };
}

export function archiveEntryLabel(entry: BillArchiveEntry): string {
  return [entry.holder, `POD ${entry.pod}`, entry.period, entry.stateLabel].join(" · ");
}

/** Entries matching every word typed (holder, POD, period, supplier, state), A to Z by holder. */
export function searchArchive(entries: readonly BillArchiveEntry[], query: string): readonly BillArchiveEntry[] {
  const words = query.toLocaleLowerCase("it").split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => { const haystack = [entry.holder, entry.pod, entry.period, entry.supplier ?? "", entry.stateLabel].join(" ").toLocaleLowerCase("it"); return words.every((word) => haystack.includes(word)); })
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
