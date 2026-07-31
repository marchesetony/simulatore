import { randomUUID } from "node:crypto";
import type { CteContract } from "../types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertCalculationReadyFees, toCalculationReadyOffer } from "../calculation-ready.ts";
import type { CteArchiveApproval, CteArchiveRecord, CteArchiveStatus, CteArchiveVersion, CorrectCteArchiveInput, CreateCteArchiveInput } from "./types";
import type { CteArchiveRepository } from "./types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertApprovalReady, assertArchiveContract, assertTenantId, intervalsOverlap } from "./validation.ts";

const nowValue = (value?: string): string => {
  const result = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(result))) throw new Error("DATE_TIME_INVALID");
  const date = result.slice(0, 10);
  const parsedDate = Date.parse(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(result) || !Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== date) throw new Error("DATE_TIME_INVALID");
  return result;
};
const actorValue = (value?: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("ACTOR_REQUIRED");
  return value.trim();
};
const statusForContract = (contract: CteContract): CteArchiveStatus => contract.approval.status === "APPROVED" ? "APPROVED" : contract.approval.status === "NEEDS_REVIEW" ? "REVIEWED" : contract.approval.status;

function contractWithApproval(contract: CteContract, approval: CteContract["approval"]): CteContract {
  return { ...contract, approval } as CteContract;
}

function versionFor(record: CteArchiveRecord, versionId: string): CteArchiveVersion {
  const version = record.versions.find((candidate) => candidate.versionId === versionId);
  if (!version) throw new Error("CTE_VERSION_NOT_FOUND");
  return version;
}

function sortVersions(versions: readonly CteArchiveVersion[]): readonly CteArchiveVersion[] {
  return [...versions].sort((left, right) => left.versionNumber - right.versionNumber || left.versionId.localeCompare(right.versionId));
}

function currentApproved(record: CteArchiveRecord): CteArchiveVersion | null {
  const candidates = record.versions.filter((version) => version.status === "APPROVED");
  return [...candidates].sort((left, right) => right.versionNumber - left.versionNumber || right.versionId.localeCompare(left.versionId))[0] ?? null;
}

function sameOffer(left: CteContract, right: CteContract): boolean {
  return left.vector === right.vector && left.supplier.supplierId === right.supplier.supplierId && left.offer.code === right.offer.code;
}

function ensureNoApprovedOverlap(record: CteArchiveRecord, candidate: CteArchiveVersion): void {
  for (const version of record.versions) {
    if (version.versionId === candidate.versionId || version.status !== "APPROVED") continue;
    if (intervalsOverlap(version.contract.validity.periodStart, version.contract.validity.periodEnd, candidate.contract.validity.periodStart, candidate.contract.validity.periodEnd)) {
      throw new Error("CTE_APPROVED_VALIDITY_OVERLAP");
    }
  }
}

function event(record: CteArchiveRecord, type: CteArchiveRecord["history"][number]["type"], version: CteArchiveVersion, at: string, actor: string, reason: string | null, sourceVersionId: string | null) {
  return { eventId: randomUUID(), type, tenantId: record.tenantId, cteId: record.cteId, versionId: version.versionId, versionNumber: version.versionNumber, at, actor, reason, sourceVersionId };
}

export async function createCteArchive(repository: CteArchiveRepository, input: CreateCteArchiveInput): Promise<CteArchiveRecord> {
  assertTenantId(input.tenantId);
  assertArchiveContract(input.contract, input.tenantId);
  const now = nowValue(input.now);
  const actor = actorValue(input.actor ?? "LOCAL_IMPORT");
  const archiveId = input.archiveId ?? input.contract.cteId;
  const existing = await repository.get(input.tenantId, archiveId);
  if (existing) throw new Error("CTE_ARCHIVE_ALREADY_EXISTS");
  const versionId = randomUUID();
  const version: CteArchiveVersion = { versionId, versionNumber: 1, supersedesVersionId: null, status: statusForContract(input.contract), contract: input.contract, createdAt: now };
  if (version.status === "APPROVED") {
    ensureCalculationReady(input.contract);
    const overlap = (await repository.list(input.tenantId)).some((candidate) => { const approved = candidate.currentApprovedVersionId ? candidate.versions.find((item) => item.versionId === candidate.currentApprovedVersionId) : null; return approved !== null && approved !== undefined && sameOffer(approved.contract, input.contract) && intervalsOverlap(approved.contract.validity.periodStart, approved.contract.validity.periodEnd, input.contract.validity.periodStart, input.contract.validity.periodEnd); });
    if (overlap) throw new Error("CTE_APPROVED_VALIDITY_OVERLAP");
  }
  const record: CteArchiveRecord = {
    archiveId, tenantId: input.tenantId, cteId: input.contract.cteId, vector: input.contract.vector,
    createdAt: now, updatedAt: now, currentWorkingVersionId: versionId,
    currentApprovedVersionId: version.status === "APPROVED" ? versionId : null,
    versions: [version], approvals: version.status === "APPROVED" ? [approvalFor(version, actor, now, "APPROVED", null)] : [],
    history: [event({ archiveId, tenantId: input.tenantId, cteId: input.contract.cteId, vector: input.contract.vector, createdAt: now, updatedAt: now, currentWorkingVersionId: versionId, currentApprovedVersionId: version.status === "APPROVED" ? versionId : null, versions: [version], approvals: [], history: [] }, "CREATED", version, now, actor, null, null)],
  };
  await repository.save(record);
  return structuredClone(record);
}

function ensureCalculationReady(contract: CteContract, approval?: CteContract["approval"]): void {
  const candidate = approval ? contractWithApproval(contract, approval) : contract;
  assertApprovalReady(candidate);
  const ready = toCalculationReadyOffer(candidate);
  assertCalculationReadyFees([...ready.fixedFees, ...ready.variableFees, ...ready.oneOffFees, ...ready.commercialDiscounts]);
  if (ready.imbalance.status === "DECLARED") assertCalculationReadyFees([ready.imbalance.component]);
}

function approvalFor(version: CteArchiveVersion, actor: string, at: string, decision: "APPROVED" | "REJECTED", supersedesApprovalId: string | null): CteArchiveApproval {
  return { approvalId: randomUUID(), versionId: version.versionId, versionNumber: version.versionNumber, decision, reviewer: actor, decisionId: `${decision.toLowerCase()}-${version.versionId}`, decidedAt: at, supersedesApprovalId };
}

export async function createCteCorrection(repository: CteArchiveRepository, input: CorrectCteArchiveInput): Promise<CteArchiveRecord> {
  assertTenantId(input.tenantId);
  const record = await repository.get(input.tenantId, input.archiveId);
  if (!record) throw new Error("CTE_ARCHIVE_NOT_FOUND");
  if (record.currentWorkingVersionId !== input.expectedVersionId) throw new Error("CTE_VERSION_STALE");
  const source = versionFor(record, input.expectedVersionId);
  if (input.contract.vector !== record.vector) throw new Error("VECTOR_MISMATCH");
  assertArchiveContract(input.contract, input.tenantId, record.cteId);
  const now = nowValue(input.now);
  const actor = actorValue(input.actor ?? "LOCAL_CORRECTION");
  const version: CteArchiveVersion = { versionId: randomUUID(), versionNumber: Math.max(...record.versions.map((candidate) => candidate.versionNumber)) + 1, supersedesVersionId: source.versionId, status: "DRAFT", contract: contractWithApproval(input.contract, { status: "DRAFT", reason: "CORRECTION_PENDING_REVIEW" }), createdAt: now };
  const next: CteArchiveRecord = { ...record, updatedAt: now, currentWorkingVersionId: version.versionId, versions: sortVersions([...record.versions, version]), history: [...record.history, event(record, "CORRECTED", version, now, actor, input.reason ?? null, source.versionId)] };
  await repository.save(next);
  return structuredClone(next);
}

export async function reviewCteArchive(repository: CteArchiveRepository, tenantId: string, archiveId: string, versionId: string, reviewer: string, at?: string): Promise<CteArchiveRecord> {
  assertTenantId(tenantId);
  const record = await repository.get(tenantId, archiveId);
  if (!record) throw new Error("CTE_ARCHIVE_NOT_FOUND");
  if (record.currentWorkingVersionId !== versionId) throw new Error("CTE_VERSION_NOT_CURRENT");
  const source = versionFor(record, versionId);
  if (source.status !== "DRAFT" && source.status !== "REJECTED") throw new Error("CTE_VERSION_NOT_REVIEWABLE");
  const when = nowValue(at); const actor = actorValue(reviewer);
  const reviewed: CteArchiveVersion = { ...source, status: "REVIEWED", contract: contractWithApproval(source.contract, { status: "NEEDS_REVIEW", reason: "READY_FOR_APPROVAL" }) };
  const next: CteArchiveRecord = { ...record, updatedAt: when, versions: sortVersions(record.versions.map((version) => version.versionId === versionId ? reviewed : version)), history: [...record.history, event(record, "REVIEWED", reviewed, when, actor, null, source.supersedesVersionId)] };
  await repository.save(next); return structuredClone(next);
}

export async function approveCteArchive(repository: CteArchiveRepository, tenantId: string, archiveId: string, versionId: string, reviewer: string, decisionId: string, at?: string): Promise<CteArchiveRecord> {
  assertTenantId(tenantId);
  const record = await repository.get(tenantId, archiveId);
  if (!record) throw new Error("CTE_ARCHIVE_NOT_FOUND");
  if (record.currentWorkingVersionId !== versionId) throw new Error("CTE_VERSION_NOT_CURRENT");
  const source = versionFor(record, versionId);
  if (source.status === "APPROVED") throw new Error("CTE_VERSION_ALREADY_APPROVED");
  const when = nowValue(at);
  const actor = actorValue(reviewer);
  const approvedMetadata = { status: "APPROVED" as const, reviewer: actor, reviewedAt: when, decisionId: actorValue(decisionId) };
  ensureCalculationReady(source.contract, approvedMetadata);
  const previous = currentApproved(record);
  const versions = record.versions.map((version) => version.versionId === source.versionId
    ? { ...version, status: "APPROVED" as const, contract: contractWithApproval(version.contract, approvedMetadata) }
    : previous && version.versionId === previous.versionId ? { ...version, status: "EXPIRED" as const } : version);
  const approvedVersion = versions.find((version) => version.versionId === source.versionId) as CteArchiveVersion;
  ensureNoApprovedOverlap({ ...record, versions }, approvedVersion);
  const overlap = (await repository.list(tenantId)).filter((candidate) => candidate.archiveId !== archiveId && candidate.currentApprovedVersionId !== null).some((candidate) => { const approved = candidate.versions.find((item) => item.versionId === candidate.currentApprovedVersionId); return approved ? sameOffer(approved.contract, approvedVersion.contract) && intervalsOverlap(approved.contract.validity.periodStart, approved.contract.validity.periodEnd, approvedVersion.contract.validity.periodStart, approvedVersion.contract.validity.periodEnd) : false; });
  if (overlap) throw new Error("CTE_APPROVED_VALIDITY_OVERLAP");
  const approval = approvalFor(approvedVersion, actor, when, "APPROVED", record.approvals.at(-1)?.approvalId ?? null);
  const next: CteArchiveRecord = { ...record, updatedAt: when, currentApprovedVersionId: approvedVersion.versionId, versions: sortVersions(versions), approvals: [...record.approvals, approval], history: [...record.history, ...(previous ? [event(record, "EXPIRED", previous, when, actor, "SUPERSEDED_BY_APPROVAL", null)] : []), event(record, "APPROVED", approvedVersion, when, actor, null, source.supersedesVersionId)] };
  await repository.save(next);
  return structuredClone(next);
}

export async function rejectCteArchive(repository: CteArchiveRepository, tenantId: string, archiveId: string, versionId: string, reviewer: string, reason: string, at?: string): Promise<CteArchiveRecord> {
  assertTenantId(tenantId);
  if (typeof reason !== "string" || !reason.trim()) throw new Error("REJECTION_REASON_REQUIRED");
  const record = await repository.get(tenantId, archiveId);
  if (!record) throw new Error("CTE_ARCHIVE_NOT_FOUND");
  if (record.currentWorkingVersionId !== versionId) throw new Error("CTE_VERSION_NOT_CURRENT");
  const source = versionFor(record, versionId);
  if (source.status === "APPROVED") throw new Error("CTE_VERSION_ALREADY_APPROVED");
  const when = nowValue(at); const actor = actorValue(reviewer);
  const rejectedMetadata = { status: "REJECTED" as const, reason: reason.trim() };
  const versions = record.versions.map((version) => version.versionId === source.versionId ? { ...version, status: "REJECTED" as const, contract: contractWithApproval(version.contract, rejectedMetadata) } : version);
  const rejected = versions.find((version) => version.versionId === source.versionId) as CteArchiveVersion;
  const approval = approvalFor(rejected, actor, when, "REJECTED", record.approvals.at(-1)?.approvalId ?? null);
  const next: CteArchiveRecord = { ...record, updatedAt: when, versions: sortVersions(versions), approvals: [...record.approvals, approval], history: [...record.history, event(record, "REJECTED", rejected, when, actor, reason.trim(), source.supersedesVersionId)] };
  await repository.save(next);
  return structuredClone(next);
}

export async function getCteArchiveHistory(repository: CteArchiveRepository, tenantId: string, archiveId: string): Promise<ReadonlyArray<CteArchiveRecord["history"][number]>> {
  const record = await repository.get(tenantId, archiveId);
  if (!record) throw new Error("CTE_ARCHIVE_NOT_FOUND");
  return structuredClone([...record.history].sort((left, right) => left.at.localeCompare(right.at) || left.eventId.localeCompare(right.eventId)));
}

export function currentWorkingCteVersion(record: CteArchiveRecord): CteArchiveVersion { return versionFor(record, record.currentWorkingVersionId); }
export function currentApprovedCteVersion(record: CteArchiveRecord): CteArchiveVersion | null { return record.currentApprovedVersionId ? versionFor(record, record.currentApprovedVersionId) : null; }

export const importCteArchive = createCteArchive;

export class CteArchiveService {
  private readonly repository: CteArchiveRepository;
  constructor(repository: CteArchiveRepository) { this.repository = repository; }
  create(input: CreateCteArchiveInput): Promise<CteArchiveRecord> { return createCteArchive(this.repository, input); }
  import(input: CreateCteArchiveInput): Promise<CteArchiveRecord> { return createCteArchive(this.repository, input); }
  correct(input: CorrectCteArchiveInput): Promise<CteArchiveRecord> { return createCteCorrection(this.repository, input); }
  review(tenantId: string, archiveId: string, versionId: string, reviewer: string, at?: string): Promise<CteArchiveRecord> { return reviewCteArchive(this.repository, tenantId, archiveId, versionId, reviewer, at); }
  approve(tenantId: string, archiveId: string, versionId: string, reviewer: string, decisionId: string, at?: string): Promise<CteArchiveRecord> { return approveCteArchive(this.repository, tenantId, archiveId, versionId, reviewer, decisionId, at); }
  reject(tenantId: string, archiveId: string, versionId: string, reviewer: string, reason: string, at?: string): Promise<CteArchiveRecord> { return rejectCteArchive(this.repository, tenantId, archiveId, versionId, reviewer, reason, at); }
  history(tenantId: string, archiveId: string): Promise<ReadonlyArray<CteArchiveRecord["history"][number]>> { return getCteArchiveHistory(this.repository, tenantId, archiveId); }
}
