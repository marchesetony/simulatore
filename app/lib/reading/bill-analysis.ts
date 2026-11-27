import type { AuthenticatedPrincipal } from "../auth/types";
import type { TenantRecord, TenantRecordRepository } from "../persistence/types";
import type { BillAnalysisHooks, BillAnalysisPhase } from "../foundation/real-bill";

/**
 * Tony (24/11/2026, "PERMESSI GERARCHICI E ANALISI BOLLETTE", Modulo B): one record per bill analysis, so that the screen
 * shows the real phase the server is in and the user can stop it for real.
 *
 * - The browser names the analysis (a random id) and sends it with the upload; the same id can never start twice and a user
 *   cannot run two analyses at once (a stuck one stops counting after ANALYSIS_STALE_MS).
 * - The server records each phase before starting it: RECEIVED, READING (the PDF goes to the reader), VALIDATING, SAVING.
 * - "Interrompi analisi" sets cancelRequested. The next phase boundary, or the save itself, sees it: nothing is saved and the
 *   stored file is removed. If the bill had just been saved, the route removes it (it is new, unapproved, with no proposals).
 * - Nothing here reads prices, CTE or calculations, and nothing changes a bill that existed before the analysis.
 */

export type BillAnalysisState = "RECEIVED" | BillAnalysisPhase | "COMPLETED" | "FAILED" | "CANCELLED";
export interface BillAnalysisRecord {
  readonly analysisId: string;
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly state: BillAnalysisState;
  readonly cancelRequested: boolean;
  readonly billId: string | null;
  readonly errorCode: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly phases: readonly { readonly state: BillAnalysisState; readonly at: string }[];
}
export type BillAnalysisRepository = TenantRecordRepository<BillAnalysisRecord>;

export const ANALYSIS_ID_PATTERN = /^analysis_[a-f0-9-]{36}$/;
export const ANALYSIS_STALE_MS = 6 * 60 * 1000;
const TERMINAL: readonly BillAnalysisState[] = ["COMPLETED", "FAILED", "CANCELLED"];
export const isTerminal = (state: BillAnalysisState): boolean => TERMINAL.includes(state);

function fail(code: string): never { throw new Error(code); }

export function analysisId(value: unknown): string {
  return typeof value === "string" && ANALYSIS_ID_PATTERN.test(value) ? value : fail("BILL_ANALYSIS_ID_INVALID");
}

/** Read-modify-write with the record version; a concurrent change (the user stopping it) is read again, never overwritten. */
async function update(repository: BillAnalysisRepository, tenantId: string, id: string, change: (record: BillAnalysisRecord) => BillAnalysisRecord | null, now: () => string): Promise<BillAnalysisRecord> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await repository.get(tenantId, id);
    if (!current) fail("BILL_ANALYSIS_NOT_FOUND");
    const next = change(current.payload);
    if (!next) return current.payload;
    try { return (await repository.put({ tenantId, recordId: id, payload: { ...next, updatedAt: now() }, expectedVersion: current.version, now: now() })).payload; }
    catch (error) { if (!(error instanceof Error && error.message === "PERSISTENCE_VERSION_CONFLICT")) throw error; }
  }
  return fail("BILL_ANALYSIS_BUSY");
}

function own(record: TenantRecord<BillAnalysisRecord> | null, principal: Pick<AuthenticatedPrincipal, "tenantId" | "userId">): BillAnalysisRecord {
  // Another user's analysis, or another company's, does not exist for the caller.
  if (!record || record.tenantId !== principal.tenantId || record.payload.tenantId !== principal.tenantId || record.payload.ownerUserId !== principal.userId) fail("BILL_ANALYSIS_NOT_FOUND");
  return record.payload;
}

export async function startAnalysis(repository: BillAnalysisRepository, principal: Pick<AuthenticatedPrincipal, "tenantId" | "userId">, requestedId: unknown, now = () => new Date().toISOString()): Promise<BillAnalysisRecord> {
  const id = analysisId(requestedId);
  const at = now();
  const running = (await repository.list(principal.tenantId)).map((record) => record.payload)
    .filter((record) => record.ownerUserId === principal.userId && !isTerminal(record.state) && Date.parse(at) - Date.parse(record.updatedAt) < ANALYSIS_STALE_MS);
  if (running.some((record) => record.analysisId === id)) fail("BILL_ANALYSIS_DUPLICATE");
  if (running.length) fail("BILL_ANALYSIS_BUSY");
  const payload: BillAnalysisRecord = { analysisId: id, tenantId: principal.tenantId, ownerUserId: principal.userId, state: "RECEIVED", cancelRequested: false, billId: null, errorCode: null, startedAt: at, updatedAt: at, phases: [{ state: "RECEIVED", at }] };
  // No expected version: a second start with the same id finds the record and is refused by the store.
  try { return (await repository.put({ tenantId: principal.tenantId, recordId: id, payload, now: at })).payload; }
  catch (error) { if (error instanceof Error && error.message === "PERSISTENCE_VERSION_CONFLICT") fail("BILL_ANALYSIS_DUPLICATE"); throw error; }
}

/** The hooks ingestion calls: each phase is recorded, and a stop (the user's, or the browser closing the request) is final. */
export function analysisHooks(repository: BillAnalysisRepository, tenantId: string, id: string, signal?: AbortSignal, now = () => new Date().toISOString()): BillAnalysisHooks {
  const cancelled = async () => signal?.aborted === true || (await repository.get(tenantId, id))?.payload.cancelRequested === true;
  return {
    cancelled,
    async checkpoint(phase) {
      const record = await update(repository, tenantId, id, (current) => current.cancelRequested || isTerminal(current.state) ? null : { ...current, state: phase, phases: [...current.phases, { state: phase, at: now() }] }, now);
      if (record.cancelRequested || signal?.aborted) fail("BILL_ANALYSIS_CANCELLED");
    },
  };
}

export async function finishAnalysis(repository: BillAnalysisRepository, tenantId: string, id: string, outcome: { readonly state: "COMPLETED" | "FAILED" | "CANCELLED"; readonly billId?: string | null; readonly errorCode?: string | null }, now = () => new Date().toISOString()): Promise<BillAnalysisRecord> {
  return update(repository, tenantId, id, (current) => isTerminal(current.state) ? null : { ...current, state: outcome.state, billId: outcome.billId ?? null, errorCode: outcome.errorCode ?? null, phases: [...current.phases, { state: outcome.state, at: now() }] }, now);
}

/** Whether a bill just saved must be dropped because the user stopped the analysis meanwhile. */
export async function cancelRequested(repository: BillAnalysisRepository, tenantId: string, id: string): Promise<boolean> {
  return (await repository.get(tenantId, id))?.payload.cancelRequested === true;
}

export async function getAnalysis(repository: BillAnalysisRepository, principal: Pick<AuthenticatedPrincipal, "tenantId" | "userId">, requestedId: unknown): Promise<BillAnalysisRecord> {
  const id = analysisId(requestedId);
  return own(await repository.get(principal.tenantId, id), principal);
}

/** "Interrompi analisi": only the user who started it; an analysis already finished is returned as it is. */
export async function requestCancel(repository: BillAnalysisRepository, principal: Pick<AuthenticatedPrincipal, "tenantId" | "userId">, requestedId: unknown, now = () => new Date().toISOString()): Promise<BillAnalysisRecord> {
  const id = analysisId(requestedId);
  own(await repository.get(principal.tenantId, id), principal);
  return update(repository, principal.tenantId, id, (current) => isTerminal(current.state) || current.cancelRequested ? null : { ...current, cancelRequested: true }, now);
}

/** "Annulla" after the reading: the analysis is marked as discarded once its new bill has been removed by the route. */
export async function markDiscarded(repository: BillAnalysisRepository, tenantId: string, id: string, now = () => new Date().toISOString()): Promise<BillAnalysisRecord> {
  return update(repository, tenantId, id, (current) => current.state !== "COMPLETED" ? null : { ...current, state: "CANCELLED", phases: [...current.phases, { state: "CANCELLED", at: now() }] }, now);
}

/** What the screen receives: never another user's data, never anything of the bill beyond its id. */
export function publicAnalysis(record: BillAnalysisRecord) {
  return { analysisId: record.analysisId, state: record.state, cancelRequested: record.cancelRequested, billId: record.billId, errorCode: record.errorCode, phases: record.phases };
}
