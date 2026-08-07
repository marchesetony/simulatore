import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalCteApprovedView, canonicalCteData, canonicalCteReviewView } from "../app/lib/cte/canonical-view.ts";
import { legacyCteApprovedSnapshot } from "../app/lib/cte/approved-snapshot.ts";
import { toPublicCteApprovedArchiveDetail } from "../app/lib/cte/archive/service.ts";
import { LocalCteArchiveRepository } from "../app/lib/cte/archive/repository.ts";
import { toPublicCteIngestion } from "../app/lib/cte/ingestion.ts";

const tenant = "tenant_local-demo";
const ingestion = JSON.parse(await readFile("var/phase6/cte-archives/tenant_local-demo/cte-ingestion-c30431e0-11ab-460d-ad10-6a26eb23b63d.json", "utf8"));
const archive = await new LocalCteArchiveRepository().get(tenant, ingestion.recordId);
assert.ok(archive?.currentApprovedVersionId);
const approvedVersion = archive.versions.find((version) => version.versionId === archive.currentApprovedVersionId);
assert.ok(approvedVersion);
const snapshot = legacyCteApprovedSnapshot({ record: ingestion.payload, tenantId: tenant, contract: approvedVersion.contract });
const approvedDetail = toPublicCteApprovedArchiveDetail(archive, snapshot);
assert.ok(approvedDetail);

const reviewModel = canonicalCteReviewView(toPublicCteIngestion({ ...ingestion, payload: { ...ingestion.payload, status: "REVIEW_REQUIRED" } }));
const approvedModel = canonicalCteApprovedView({ archiveId: archive.archiveId, ...approvedDetail });
assert.deepEqual(canonicalCteData(reviewModel), canonicalCteData(approvedModel));
assert.equal(reviewModel.mode, "review");
assert.equal(approvedModel.mode, "approved");
assert.equal(reviewModel.status, "REVIEW_REQUIRED");
assert.equal(approvedModel.status, "APPROVED");
assert.equal(reviewModel.reviewFields.find((field) => field.fieldKey === "eligibility.consumptionRange")?.normalizedValue, "Oltre 1.500 e fino a 200.000 kWh/anno");
assert.equal(approvedModel.reviewFields.find((field) => field.fieldKey === "eligibility.consumptionRange")?.normalizedValue, "Oltre 1.500 e fino a 200.000 kWh/anno");

const ui = await readFile(new URL("../app/components/CteIngestionPanel.tsx", import.meta.url), "utf8");
assert.equal((ui.match(/function CteContractSummary/g) ?? []).length, 1);
assert.doesNotMatch(ui, /function ApprovedSummaryGroup|function ApprovedCommercialTable|approvedReviewField|approvedReviewText/);
assert.match(ui, /canonicalCteReviewView/);
assert.match(ui, /canonicalCteApprovedView/);
assert.match(ui, /mode === "review"/);
assert.match(ui, /model\.mode === "review"/);
console.log("cte approved exact review parity smoke: ok (same persisted snapshot, canonical data and single renderer)");
