import { createHash } from "node:crypto";
import type {
  EffectiveVersion,
  EvidenceReference,
  MarketDataPoint,
  MarketDataSeries,
  OfficialSource,
  RegulatoryEntity,
  RegulatoryEntityType,
  ReviewDecision,
} from "./regulatory-types";

export const ALLOWED_INSTITUTIONS = ["ARERA", "GME", "TERNA", "ACQUIRENTE_UNICO", "SII", "OTHER_COMPETENT"] as const;

export function validateTenantId(tenantId: string): string {
  if (!/^tenant_[a-z0-9-]+$/.test(tenantId)) throw new Error("TENANT_ID_INVALID");
  return tenantId;
}

export function deterministicId(kind: string, identifier: string, version: string): string {
  return `${kind}_${createHash("sha256").update(`${kind}|${identifier}|${version}`).digest("hex").slice(0, 24)}`;
}

export function nextVersion(version: string): string {
  const parts = version.split(".").map((item) => Number.parseInt(item, 10));
  if (parts.length === 0 || parts.some((part) => !Number.isSafeInteger(part) || part < 1)) throw new Error("VERSION_FORMAT_INVALID");
  parts[parts.length - 1] += 1;
  return parts.join(".");
}

export function canonicalPayload(value: object): string {
  const normalize = (item: unknown): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(normalize).join(",")}]`;
    const record = item as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${normalize(record[key])}`).join(",")}}`;
  };
  return normalize(value);
}

export function checksumFor(value: object): string {
  return createHash("sha256").update(canonicalPayload(value)).digest("hex");
}

export function validateChecksum(value: { readonly checksum: string } & object): void {
  const payload = { ...value };
  delete (payload as { checksum?: string }).checksum;
  if (checksumFor(payload) !== value.checksum.toLowerCase()) throw new Error("CHECKSUM_MISMATCH");
}

export function validateInterval(value: EffectiveVersion): void {
  const start = Date.parse(value.effectiveFrom);
  const end = value.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(value.effectiveTo);
  if (!Number.isFinite(start) || (value.effectiveTo !== null && !Number.isFinite(end)) || start >= end) throw new Error("EFFECTIVE_INTERVAL_INVALID");
}

export function validateSource(source: OfficialSource): void {
  validateTenantId(source.tenantId);
  if (!ALLOWED_INSTITUTIONS.includes(source.sourceInstitution) || source.sourceInstitution.trim() !== source.sourceInstitution) throw new Error("SOURCE_AUTHORITY_REJECTED");
  if (!source.id.trim() || !source.officialIdentifier.trim() || !/^https:\/\//.test(source.sourceUrl) || !source.version || source.parentVersionId === undefined) throw new Error("SOURCE_METADATA_INVALID");
  validateChecksum(source);
}

export function requiredBands(structure: MarketDataSeries["structure"]): readonly string[] {
  return structure === "MONO" ? ["MONORARY"] : structure === "F1_F23" ? ["F1", "F23"] : ["F1", "F2", "F3"];
}

export function validateSeries(series: MarketDataSeries): void {
  validateTenantId(series.tenantId);
  if (series.market !== "ELECTRICITY") throw new Error("GAS_UNSUPPORTED");
  validateInterval(series);
  validateChecksum(series);
  if (series.approvalStatus === "APPROVED" && !series.reviewer) throw new Error("REVIEW_REQUIRED");
}

export function validatePoints(series: MarketDataSeries, points: readonly MarketDataPoint[]): void {
  validateSeries(series);
  const required = requiredBands(series.structure);
  const seen = new Set<string>();
  for (const point of points) {
    validateTenantId(point.tenantId);
    validateInterval(point);
    validateChecksum(point);
    if (point.tenantId !== series.tenantId || point.sourceId !== series.sourceId || point.seriesId !== series.id || !Number.isFinite(point.value) || seen.has(point.band)) throw new Error("MARKET_DATA_CONFLICT");
    seen.add(point.band);
  }
  if (required.some((band) => !seen.has(band)) || seen.size !== required.length) throw new Error("TARIFF_BANDS_INCOMPLETE");
}

export function validateApprovedEntityProvenance(subjectType: RegulatoryEntityType, entity: RegulatoryEntity): void {
  if (entity.approvalStatus !== "APPROVED") return;
  if (!entity.reviewer?.trim() || !entity.reviewDecisionId?.trim() || entity.provenance.length === 0) throw new Error("APPROVAL_PROVENANCE_INVALID");
  for (const reference of entity.provenance) {
    validateEvidenceReference(reference);
    if (reference.ingestionStatus !== "APPROVED" || reference.reviewerApprovalStatus !== "APPROVED") throw new Error("APPROVAL_PROVENANCE_INVALID");
    if (reference.tenantId !== entity.tenantId || reference.subjectType !== subjectType || reference.subjectId !== entity.officialIdentifier || reference.subjectVersionId !== entity.id) throw new Error("APPROVAL_PROVENANCE_INVALID");
  }
}

export function overlaps<T extends EffectiveVersion>(values: readonly T[]): boolean {
  return values.some((a, i) => values.some((b, j) => i !== j && Date.parse(a.effectiveFrom) < (b.effectiveTo ? Date.parse(b.effectiveTo) : Infinity) && Date.parse(b.effectiveFrom) < (a.effectiveTo ? Date.parse(a.effectiveTo) : Infinity)));
}

export function validateEvidenceReference(reference: EvidenceReference): void {
  validateTenantId(reference.tenantId);
  if (!reference.id.trim() || !reference.subjectId.trim() || !reference.subjectVersionId?.trim() || !reference.sourceDocumentOrDataset.trim() || !reference.officialIdentifier.trim() || !/^https:\/\//.test(reference.sourceUrl) || !reference.immutableVersion.trim()) throw new Error("EVIDENCE_INVALID");
  if (!isRegulatoryEntityType(reference.subjectType)) throw new Error("EVIDENCE_INVALID");
  if (!Array.isArray(reference.provenance) || reference.provenance.some((item) => typeof item !== "string" || !item.trim())) throw new Error("EVIDENCE_INVALID");
  validateInterval({ ...reference, id: reference.id, version: reference.immutableVersion, parentVersionId: reference.subjectVersionId });
  validateChecksum(reference);
}

export function validateReviewDecision(decision: ReviewDecision): void {
  validateTenantId(decision.tenantId);
  if (!decision.id.trim() || !decision.subjectId.trim() || !decision.subjectVersionId?.trim() || !decision.reviewer.trim() || !decision.reason.trim() || !Number.isFinite(Date.parse(decision.reviewedAt))) throw new Error("REVIEW_INVALID");
  if (!isRegulatoryEntityType(decision.subjectType)) throw new Error("REVIEW_INVALID");
  if (!Array.isArray(decision.evidenceReferences) || decision.evidenceReferences.length === 0) throw new Error("REVIEW_INVALID");
  for (const reference of decision.evidenceReferences) validateEvidenceReference(reference);
}

export function isRegulatoryEntityType(value: string): value is RegulatoryEntityType {
  return value === "OfficialSource" || value === "RegulatoryDocument" || value === "RegulatoryRuleVersion" || value === "MarketDataSeries" || value === "MarketDataPoint";
}
