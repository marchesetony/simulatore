import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { checksumFor } from "../app/lib/foundation/regulatory-validation.ts";
import { ProductionRegulatoryPersistenceBridge } from "../app/lib/regulatory-bridge.ts";
import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import {
  RegulatoryApprovalDomainService,
  collisionDomainKey,
  regulatoryApprovalDomainId,
} from "../app/lib/regulatory-approval-domain.ts";

const tenantId = "tenant_c3-smoke";
const principalId = "user_c3-admin";
const baseRequest = { tenantId, principalId, role: "ADMIN", correlationId: "c3-smoke", evidenceReference: "https://official.example/c3-smoke" };

function record({ id, componentCode = "UC3", normalizedUnit = "EUR/KWH", effectiveFrom, effectiveTo, normalizedValue = 1 }) {
  const base = {
    tenantId,
    id,
    identityKey: `${tenantId}|${id}`,
    version: "1",
    parentVersionId: null,
    authority: "ARERA",
    sourceType: "OFFICIAL_ATTACHMENT",
    sourceReference: "https://official.example/c3-source",
    officialIdentifier: `OFFICIAL-${id}`,
    publicationDate: "2026-06-01T00:00:00.000Z",
    retrievedAt: "2026-06-02T00:00:00.000Z",
    effectiveFrom,
    effectiveTo,
    vector: "EE",
    customerScope: "DOMESTIC_RESIDENT_BT",
    componentCode,
    originalValue: normalizedValue,
    originalUnit: normalizedUnit,
    normalizedValue,
    normalizedUnit,
    applicationBasis: "synthetic C3 smoke fixture",
    sourceSha256: "a".repeat(64),
    conversionProvenance: ["synthetic-fixture"],
    approvalStatus: "IMPORTED",
    reviewStatus: "NEEDS_REVIEW",
  };
  return { ...base, checksum: checksumFor(base) };
}

function request(targetRecordId, idempotencyKey) {
  return { ...baseRequest, targetRecordId, idempotencyKey };
}

const root = await mkdtemp(path.join(os.tmpdir(), "c3-regulatory-approval-"));
try {
  const local = new LocalFilesystemAdapter(root);
  const regulatoryValues = local.collection("regulatory-values");
  const approvalDomains = local.collection("regulatory-approval-domains");
  const auditEvents = local.collection("audit-events");
  const service = new RegulatoryApprovalDomainService({ regulatoryValues, approvalDomains, auditEvents });

  const overlapA = record({ id: "c3-overlap-a", effectiveFrom: "2026-07-01T00:00:00.000Z", effectiveTo: "2026-10-01T00:00:00.000Z" });
  const overlapB = record({ id: "c3-overlap-b", effectiveFrom: "2026-08-01T00:00:00.000Z", effectiveTo: "2026-11-01T00:00:00.000Z", normalizedValue: 2 });
  const adjacent = record({ id: "c3-adjacent", effectiveFrom: "2026-10-01T00:00:00.000Z", effectiveTo: "2027-01-01T00:00:00.000Z", normalizedValue: 3 });
  const replacement = record({ id: "c3-replacement", effectiveFrom: "2027-01-01T00:00:00.000Z", effectiveTo: "2027-04-01T00:00:00.000Z", normalizedValue: 4 });
  const replacementNew = record({ id: "c3-replacement-new", effectiveFrom: "2027-01-01T00:00:00.000Z", effectiveTo: "2027-04-01T00:00:00.000Z", normalizedValue: 5 });
  const openA = record({ id: "c3-open-a", normalizedUnit: "TEST/OPEN", effectiveFrom: "2026-07-01T00:00:00.000Z", effectiveTo: null });
  const openB = record({ id: "c3-open-b", normalizedUnit: "TEST/OPEN", effectiveFrom: "2026-10-01T00:00:00.000Z", effectiveTo: null, normalizedValue: 2 });
  const uc6Energy = record({ id: "c3-uc6-energy", componentCode: "UC6", normalizedUnit: "EUR/KWH", effectiveFrom: "2026-07-01T00:00:00.000Z", effectiveTo: "2027-01-01T00:00:00.000Z" });
  const uc6Power = record({ id: "c3-uc6-power", componentCode: "UC6", normalizedUnit: "EUR/KW/YEAR", effectiveFrom: "2026-07-01T00:00:00.000Z", effectiveTo: "2027-01-01T00:00:00.000Z" });
  const all = [overlapA, overlapB, adjacent, replacement, replacementNew, openA, openB, uc6Energy, uc6Power];
  for (const value of all) await regulatoryValues.append({ tenantId, recordId: value.id, payload: value, idempotencyKey: value.checksum });

  assert.notEqual(
    regulatoryApprovalDomainId(tenantId, collisionDomainKey(uc6Energy)),
    regulatoryApprovalDomainId(tenantId, collisionDomainKey(uc6Power)),
    "UC6 energy and power use different state rows",
  );

  const concurrent = await Promise.allSettled([
    service.approveRegulatoryValue(request(overlapA.id, "approve-overlap-a")),
    service.approveRegulatoryValue(request(overlapB.id, "approve-overlap-b")),
  ]);
  assert.equal(concurrent.filter((item) => item.status === "fulfilled").length, 1, "one overlapping approval wins");
  assert.equal(concurrent.filter((item) => item.status === "rejected").length, 1, "one overlapping approval loses");
  assert.equal(concurrent.find((item) => item.status === "rejected")?.reason?.message, "REGULATORY_APPROVAL_BLOCKED");
  const winner = concurrent.find((item) => item.status === "fulfilled").value;

  const bridge = new ProductionRegulatoryPersistenceBridge(regulatoryValues, approvalDomains);
  assert.deepEqual((await bridge.list(tenantId, { componentCode: "UC3", customerScope: "DOMESTIC_RESIDENT_BT", normalizedUnit: "EUR/KWH" })).map((item) => item.id), [winner.targetRecordId], "bridge exposes only the effective approval");
  assert.equal((await auditEvents.list(tenantId)).length, 2, "both concurrent attempts are auditable");

  if (winner.targetRecordId !== overlapA.id) {
    await service.revokeRegulatoryValue(request(overlapB.id, "revoke-overlap-b"));
    await service.approveRegulatoryValue(request(overlapA.id, "approve-overlap-a-after-race"));
  }
  await service.approveRegulatoryValue(request(adjacent.id, "approve-adjacent"));
  assert.deepEqual((await bridge.list(tenantId, { componentCode: "UC3", customerScope: "DOMESTIC_RESIDENT_BT", normalizedUnit: "EUR/KWH" })).map((item) => item.id).sort(), [overlapA.id, adjacent.id].sort(), "adjacent intervals can both be effective");

  const revokeTarget = overlapA.id;
  const revokeResult = await service.revokeRegulatoryValue(request(revokeTarget, "revoke-winner"));
  assert.equal(revokeResult.effective, true);
  assert.equal((await bridge.list(tenantId, { componentCode: "UC3", customerScope: "DOMESTIC_RESIDENT_BT", normalizedUnit: "EUR/KWH" })).some((item) => item.id === revokeTarget), false, "revoked approval is not visible");
  const revokeRetry = await service.revokeRegulatoryValue(request(revokeTarget, "revoke-winner"));
  assert.equal(revokeRetry.effective, false, "revoking a non-effective target is deterministic no-op");

  await service.approveRegulatoryValue(request(replacement.id, "approve-replacement-old"));
  const correction = await service.replaceRegulatoryValue({ ...baseRequest, oldTargetRecordId: replacement.id, newTargetRecordId: replacementNew.id, idempotencyKey: "replace-replacement", });
  assert.equal(correction.effective, true);
  const correctionVisible = await bridge.list(tenantId, { componentCode: "UC3", customerScope: "DOMESTIC_RESIDENT_BT", normalizedUnit: "EUR/KWH" });
  assert.equal(correctionVisible.some((item) => item.id === replacement.id), false, "old correction target is hidden");
  assert.equal(correctionVisible.some((item) => item.id === replacementNew.id), true, "new correction target is visible");

  await service.approveRegulatoryValue(request(openA.id, "approve-open-a"));
  await assert.rejects(() => service.approveRegulatoryValue(request(openB.id, "approve-open-b")), /REGULATORY_APPROVAL_BLOCKED/);

  await service.approveRegulatoryValue(request(uc6Energy.id, "approve-uc6-energy"));
  await service.approveRegulatoryValue(request(uc6Power.id, "approve-uc6-power"));
  assert.equal((await bridge.list(tenantId, { componentCode: "UC6", customerScope: "DOMESTIC_RESIDENT_BT" })).length, 2, "UC6 energy and power can be approved in parallel domains");
  const auditCountBeforeRetry = (await auditEvents.list(tenantId)).length;
  const retry = await service.approveRegulatoryValue(request(uc6Energy.id, "approve-uc6-energy"));
  assert.equal(retry.idempotent, true);
  assert.equal((await auditEvents.list(tenantId)).length, auditCountBeforeRetry, "same approval retry does not append a second event");

  await assert.rejects(() => service.approveRegulatoryValue({ ...request(uc6Power.id, "viewer-attempt"), role: "VIEWER" }), /REGULATORY_APPROVAL_ADMIN_REQUIRED/);

  class ProviderConflictOnceRepository {
    constructor(delegate) { this.delegate = delegate; this.failed = false; }
    get(...args) { return this.delegate.get(...args); }
    list(...args) { return this.delegate.list(...args); }
    append(...args) { return this.delegate.append(...args); }
    async put(...args) { if (!this.failed) { this.failed = true; throw new Error("23505"); } return this.delegate.put(...args); }
  }
  const providerLikeDomains = new ProviderConflictOnceRepository(local.collection("provider-like-approval-domains"));
  const providerLikeService = new RegulatoryApprovalDomainService({ regulatoryValues, approvalDomains: providerLikeDomains, auditEvents });
  const providerLike = record({ id: "c3-provider-conflict", normalizedUnit: "TEST/PROVIDER", effectiveFrom: "2028-01-01T00:00:00.000Z", effectiveTo: "2028-02-01T00:00:00.000Z" });
  await regulatoryValues.append({ tenantId, recordId: providerLike.id, payload: providerLike, idempotencyKey: providerLike.checksum });
  const providerResult = await providerLikeService.approveRegulatoryValue(request(providerLike.id, "approve-provider-conflict"));
  assert.equal(providerResult.effective, true, "provider 23505 is retried only after fresh read");

  console.log("REGULATORY_APPROVAL_DOMAIN_SMOKE=OK");
} finally {
  await rm(root, { recursive: true, force: true });
}
