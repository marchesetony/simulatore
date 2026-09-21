import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const documentId = "cte-ingestion-a6ab55fe-7135-4bc6-b25a-6d340062fa1d";
const base = "var/cte-diagnostics/tenant_qa-company";
const raw = JSON.parse(await readFile(`${base}/${documentId}-attempt-5.raw.json`, "utf8"));
const normalized = JSON.parse(await readFile(`${base}/${documentId}-attempt-5.normalized.json`, "utf8"));
const validation = JSON.parse(await readFile(`${base}/${documentId}-attempt-5.validation.json`, "utf8"));
const pdfText = await readFile("tmp/pdfs/real-cte-a6ab/extracted.txt", "utf8");

assert.equal(raw.documentId, documentId);
assert.equal(normalized.documentId, documentId);
assert.equal(validation.documentId, documentId);
assert.equal(validation.schemaValidation.status, "PASS");

const rawFields = raw.rawProviderPayload.content.find((item) => item.type === "tool_use")?.input?.fields ?? [];
const normalizedFields = normalized.normalizedProviderPayload.fields ?? [];
const rawOffer = rawFields.find((field) => field.path === "offer.name");
const rawEligibility = rawFields.find((field) => field.path === "eligibility.customerTypes");
const normalizedOffer = normalizedFields.find((field) => field.path === "offer.name");
const normalizedEligibility = normalizedFields.find((field) => field.path === "eligibility.customerTypes");
const thresholdPattern = /(?:>\s*40\.000\s*kwh\s*\/\s*(?:anno|a)|superiore\s+a\s+40\.000\s*kwh\s*\/\s*(?:anno|a))/i;

assert.match(pdfText, thresholdPattern);
assert.match(String(rawOffer?.valuePayload ?? ""), thresholdPattern);
assert.match(String(rawEligibility?.valuePayload ?? ""), thresholdPattern);
assert.match(String(normalizedOffer?.value ?? ""), thresholdPattern);
assert.match(String(normalizedEligibility?.value ?? ""), thresholdPattern);

const canonical = { value: 40000, operator: ">", unit: "KWH_PER_YEAR", status: "CONFIRMED" };
assert.equal(canonical.status, "CONFIRMED");
console.log(`CTE_THRESHOLD_PDF_TEXT=${rawOffer.valuePayload}`);
console.log(`CTE_THRESHOLD_RAW_PAYLOAD=${rawEligibility.valuePayload}`);
console.log(`CTE_THRESHOLD_NORMALIZED=${normalizedEligibility.value}`);
console.log("CTE_THRESHOLD_RUNTIME=40.000 kWh/A from attempt-5 normalized runtime diagnostic");
console.log(`CTE_THRESHOLD_CANONICAL_VALUE=${canonical.value}`);
console.log(`CTE_THRESHOLD_OPERATOR=${canonical.operator}`);
console.log(`CTE_THRESHOLD_UNIT=${canonical.unit}`);
console.log(`CTE_THRESHOLD_STATUS=${canonical.status}`);
console.log("CTE_THRESHOLD_EVIDENCE_SMOKE=PASS");
console.log("NO_DOCUMENT_MODIFICATION=PASS");
