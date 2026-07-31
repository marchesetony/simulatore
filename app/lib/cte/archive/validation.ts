import type { CteContract } from "../types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { validateCteContract } from "../validation.ts";
import type { CteArchiveApproval, CteArchiveHistoryEvent, CteArchiveRecord, CteArchiveStatus } from "./types";

export class CteArchiveValidationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "CteArchiveValidationError"; this.code = code; }
}

const fail = (code: string): never => { throw new CteArchiveValidationError(code); };
const nonEmpty = (value: unknown, code: string): string => typeof value === "string" && value.trim() ? value : fail(code);
const dateTime = (value: unknown, code: string): string => {
  const text = nonEmpty(value, code);
  if (!Number.isFinite(Date.parse(text))) fail(code);
  const date = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(text) || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) || new Date(Date.parse(`${date}T00:00:00.000Z`)).toISOString().slice(0, 10) !== date) fail(code);
  return text;
};
const positiveInteger = (value: unknown, code: string): number => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fail(code);
const statusValues: readonly CteArchiveStatus[] = ["DRAFT", "REVIEWED", "APPROVED", "EXPIRED", "REJECTED"];

export function assertTenantId(tenantId: unknown): asserts tenantId is string {
  if (typeof tenantId !== "string" || !/^tenant_[a-z0-9-]+$/.test(tenantId)) fail("TENANT_ACCESS_DENIED");
}

export function assertArchiveDate(value: unknown, code = "DATE_INVALID"): asserts value is string {
  const text = nonEmpty(value, code);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(code);
  const parsed = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== text) fail(code);
}

export function assertArchiveContract(contract: unknown, tenantId: string, expectedCteId?: string): asserts contract is CteContract {
  try { validateCteContract(contract); } catch (error) { throw error; }
  const candidate = contract as CteContract;
  if (candidate.tenantId !== tenantId) fail("TENANT_ACCESS_DENIED");
  if (expectedCteId !== undefined && candidate.cteId !== expectedCteId) fail("CTE_ID_MISMATCH");
  assertArchiveDate(candidate.validity.periodStart, "CTE_VALIDITY_INVALID");
  assertArchiveDate(candidate.validity.periodEnd, "CTE_VALIDITY_INVALID");
  if (candidate.expiry.status === "EXPIRES_ON") {
    assertArchiveDate(candidate.expiry.date, "CTE_EXPIRY_INVALID");
    if (candidate.expiry.date < candidate.validity.periodStart) fail("CTE_EXPIRY_INVALID");
  }
}

export function assertApprovalReady(contract: CteContract): void {
  assertArchiveContract(contract, contract.tenantId);
  if (contract.approval.status === "APPROVED") return;
  // A correction is approved only after the service replaces the review metadata.
  if (contract.approval.status === "DRAFT" || contract.approval.status === "NEEDS_REVIEW" || contract.approval.status === "REJECTED") return;
  fail("CTE_APPROVAL_NOT_READY");
}

export function intervalsOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function validateStoredCteArchive(value: unknown): CteArchiveRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("ARCHIVE_METADATA_INVALID");
  const item = value as Record<string, unknown>;
  assertTenantId(item.tenantId);
  const archiveId = nonEmpty(item.archiveId, "ARCHIVE_METADATA_INVALID");
  const cteId = nonEmpty(item.cteId, "ARCHIVE_METADATA_INVALID");
  if (item.vector !== "EE" && item.vector !== "GAS") fail("VECTOR_INVALID");
  const versions = Array.isArray(item.versions) ? item.versions : fail("ARCHIVE_METADATA_INVALID");
  if (versions.length === 0) fail("ARCHIVE_METADATA_INVALID");
  const parsedVersions = versions.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) fail("ARCHIVE_METADATA_INVALID");
    const version = candidate as Record<string, unknown>;
    const versionId = nonEmpty(version.versionId, "ARCHIVE_METADATA_INVALID");
    const versionNumber = positiveInteger(version.versionNumber, "ARCHIVE_METADATA_INVALID");
    if (!statusValues.includes(version.status as CteArchiveStatus)) fail("ARCHIVE_STATUS_INVALID");
    assertArchiveContract(version.contract, item.tenantId as string, cteId);
    if ((version.contract as CteContract).vector !== item.vector) fail("VECTOR_MISMATCH");
    return { versionId, versionNumber, supersedesVersionId: version.supersedesVersionId === null ? null : nonEmpty(version.supersedesVersionId, "ARCHIVE_METADATA_INVALID"), status: version.status as CteArchiveStatus, contract: version.contract as CteContract, createdAt: dateTime(version.createdAt, "ARCHIVE_METADATA_INVALID") };
  });
  const ids = new Set<string>();
  const numbers = new Set<number>();
  for (const version of parsedVersions) {
    if (ids.has(version.versionId) || numbers.has(version.versionNumber)) fail("ARCHIVE_METADATA_INVALID");
    ids.add(version.versionId); numbers.add(version.versionNumber);
    if (version.supersedesVersionId !== null && !ids.has(version.supersedesVersionId)) fail("ARCHIVE_VERSION_CHAIN_INVALID");
  }
  const currentWorkingVersionId = nonEmpty(item.currentWorkingVersionId, "ARCHIVE_METADATA_INVALID");
  if (!ids.has(currentWorkingVersionId)) fail("ARCHIVE_METADATA_INVALID");
  const latestVersion = [...parsedVersions].sort((left, right) => right.versionNumber - left.versionNumber || right.versionId.localeCompare(left.versionId))[0];
  if (latestVersion.versionId !== currentWorkingVersionId) fail("ARCHIVE_CURRENT_WORKING_INVALID");
  const currentApprovedVersionId = item.currentApprovedVersionId === null ? null : nonEmpty(item.currentApprovedVersionId, "ARCHIVE_METADATA_INVALID");
  if (currentApprovedVersionId !== null && (!ids.has(currentApprovedVersionId) || !parsedVersions.some((version) => version.versionId === currentApprovedVersionId && version.status === "APPROVED"))) fail("ARCHIVE_METADATA_INVALID");
  const latestApproved = [...parsedVersions].filter((version) => version.status === "APPROVED").sort((left, right) => right.versionNumber - left.versionNumber || right.versionId.localeCompare(left.versionId))[0] ?? null;
  if ((latestApproved?.versionId ?? null) !== currentApprovedVersionId) fail("ARCHIVE_CURRENT_APPROVED_INVALID");
  const approvals = Array.isArray(item.approvals) ? item.approvals : fail("ARCHIVE_METADATA_INVALID");
  const parsedApprovals: readonly CteArchiveApproval[] = approvals.map((candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) fail("ARCHIVE_METADATA_INVALID");
    const approval = candidate as Record<string, unknown>;
    const versionId = nonEmpty(approval.versionId, "ARCHIVE_METADATA_INVALID");
    if (!ids.has(versionId)) fail("ARCHIVE_METADATA_INVALID");
    const decision: CteArchiveApproval["decision"] = approval.decision === "APPROVED" || approval.decision === "REJECTED" ? approval.decision : fail("ARCHIVE_METADATA_INVALID");
    return { approvalId: nonEmpty(approval.approvalId, "ARCHIVE_METADATA_INVALID"), versionId, versionNumber: positiveInteger(approval.versionNumber, "ARCHIVE_METADATA_INVALID"), decision, reviewer: nonEmpty(approval.reviewer, "ARCHIVE_METADATA_INVALID"), decisionId: nonEmpty(approval.decisionId, "ARCHIVE_METADATA_INVALID"), decidedAt: dateTime(approval.decidedAt, "ARCHIVE_METADATA_INVALID"), supersedesApprovalId: approval.supersedesApprovalId === null ? null : nonEmpty(approval.supersedesApprovalId, "ARCHIVE_METADATA_INVALID") };
  });
  const approvalIds = new Set<string>();
  for (const approval of parsedApprovals) {
    if (approvalIds.has(approval.approvalId)) fail("ARCHIVE_METADATA_INVALID");
    approvalIds.add(approval.approvalId);
    const version = parsedVersions.find((candidate) => candidate.versionId === approval.versionId);
    if (!version || version.versionNumber !== approval.versionNumber) fail("ARCHIVE_METADATA_INVALID");
  }
  const rawHistory = Array.isArray(item.history) ? item.history : fail("ARCHIVE_HISTORY_INVALID");
  if (rawHistory.length === 0) fail("ARCHIVE_HISTORY_INVALID");
  const history: readonly CteArchiveHistoryEvent[] = rawHistory.map((candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) fail("ARCHIVE_HISTORY_INVALID");
    const event = candidate as Record<string, unknown>;
    if (!["CREATED", "CORRECTED", "REVIEWED", "APPROVED", "REJECTED", "EXPIRED"].includes(event.type as string)) fail("ARCHIVE_HISTORY_INVALID");
    if (event.tenantId !== item.tenantId || event.cteId !== cteId) fail("ARCHIVE_HISTORY_INVALID");
    if (!ids.has(event.versionId as string)) fail("ARCHIVE_HISTORY_INVALID");
    return { eventId: nonEmpty(event.eventId, "ARCHIVE_HISTORY_INVALID"), type: event.type as CteArchiveHistoryEvent["type"], tenantId: item.tenantId as string, cteId, versionId: event.versionId as string, versionNumber: positiveInteger(event.versionNumber, "ARCHIVE_HISTORY_INVALID"), at: dateTime(event.at, "ARCHIVE_HISTORY_INVALID"), actor: nonEmpty(event.actor, "ARCHIVE_HISTORY_INVALID"), reason: event.reason === null ? null : nonEmpty(event.reason, "ARCHIVE_HISTORY_INVALID"), sourceVersionId: event.sourceVersionId === null ? null : nonEmpty(event.sourceVersionId, "ARCHIVE_HISTORY_INVALID") };
  });
  return { archiveId, tenantId: item.tenantId as string, cteId, vector: item.vector as "EE" | "GAS", createdAt: dateTime(item.createdAt, "ARCHIVE_METADATA_INVALID"), updatedAt: dateTime(item.updatedAt, "ARCHIVE_METADATA_INVALID"), currentWorkingVersionId, currentApprovedVersionId, versions: parsedVersions, approvals: parsedApprovals, history };
}
