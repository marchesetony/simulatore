import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAuthoritativeCteContract, cteApprovalGate, tryBuildAuthoritativeCteContract } from "../app/lib/cte/review.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archiveRoot = path.join(root, "var", "phase6", "cte-archives");
const tenantNames = await readdir(archiveRoot, { withFileTypes: true });
const candidates = [];
for (const tenant of tenantNames.filter((entry) => entry.isDirectory())) {
  const directory = path.join(archiveRoot, tenant.name);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || !entry.name.startsWith("cte-ingestion-")) continue;
    const record = JSON.parse(await readFile(path.join(directory, entry.name), "utf8"));
    if (record.payload?.status === "REVIEW_REQUIRED" && record.payload?.documentType === "CTE" && record.payload?.vector === "EE") candidates.push({ tenantId: tenant.name, payload: record.payload, updatedAt: record.updatedAt });
  }
}
const current = candidates.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
assert.ok(current, "latest local REVIEW_REQUIRED EE CTE record is required");

const input = { ...current.payload, tenantId: current.tenantId };
const result = tryBuildAuthoritativeCteContract(input);
assert.equal(result.errorCode, null);
assert.deepEqual(result.validationPaths, []);
const contract = buildAuthoritativeCteContract(input);
assert.equal(contract.vector, "EE");
assert.equal(contract.pricing.reference, "PUN");
assert.equal("PSV" in contract.pricing, false);
assert.equal(contract.currency, "EUR");
assert.equal(contract.tenantId, current.tenantId);
assert.equal(contract.approval.status, "NEEDS_REVIEW");
assert.equal(contract.supplier.supplierId, "01867000851");
assert.equal(contract.commercialTerms.commercialDiscounts.length, 0);
assert.equal(contract.commercialTerms.fixedFees.length, 1);
assert.equal(contract.commercialTerms.fixedFees[0].unit, "EUR_PER_MONTH");
assert.equal(contract.commercialTerms.variableFees.length, 1);
assert.equal(contract.commercialTerms.variableFees[0].unit, "EUR_PER_KWH");
assert.equal(contract.commercialTerms.imbalance.status, "DECLARED");
assert.equal(contract.commercialTerms.imbalance.component.unit, "EUR_PER_KWH");
assert.equal(contract.commercialTerms.oneOffFees.length, 1);
assert.equal(contract.commercialTerms.oneOffFees[0].unit, "EUR_PER_CONTRACT");

const gate = cteApprovalGate(input);
assert.equal(gate.approvalReady, true);
assert.deepEqual(gate.blockers, []);
assert.equal(current.payload.reviewedCandidate, null);
assert.equal(contract.approval.status === "APPROVED", false);
console.log("cte authoritative contract smoke: ok (real persisted review record maps server-side without auto approval)");
