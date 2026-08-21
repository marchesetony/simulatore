import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LocalRegulatoryRepository } from "../app/lib/foundation/regulatory-repository.ts";
import { backupRegulatoryArchive, createRegulatoryValue, fetchOfficialAreraSource, parseAreraDomesticJuly2026Xlsx, parseArera587Annual2026Values, ARERA_587_PDF_URL } from "../app/lib/foundation/arera-electricity-regulatory.ts";
import { importTernaQ3Official } from "../app/lib/foundation/terna-electricity-regulatory.ts";

const root = process.cwd();
const tenantId = "tenant_local-demo";
const retrievedAt = new Date().toISOString();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readHash = async (file) => sha256(await readFile(file));
const fetcher = fetch;
const areraJulyUrl = "https://www.arera.it/fileadmin/area_operatori/prezzi_e_tariffe/Corrispettivi_libero_elettrico_domestico_2026.xlsx";
const officialSources = [areraJulyUrl, ARERA_587_PDF_URL];
const official = (url) => { const host = new URL(url).hostname.toLowerCase(); if (!["arera.it", "www.arera.it", "terna.it", "www.terna.it", "dati.terna.it"].includes(host)) throw new Error("THIRD_PARTY_SOURCE"); };
officialSources.forEach(official);

const billMetadata = path.join(root, "var", "foundation-documents", "metadata.json");
const gmeMetadata = path.join(root, "var", "market-archive", "metadata.json");
const cteMetadata = path.join(root, "var", "cte-archive", "metadata.json");
const regulatoryRoot = path.join(root, "var", "foundation-regulatory-data");
const regulatoryFile = path.join(regulatoryRoot, "records.json");
const pre = { BILL: await readHash(billMetadata), GME: await readHash(gmeMetadata), CTE: await readHash(cteMetadata), REGULATORY: await readHash(regulatoryFile) };
const repo = new LocalRegulatoryRepository(regulatoryRoot);
const before = await repo.getRegulatoryValues(tenantId);

const julyPayload = await fetchOfficialAreraSource(areraJulyUrl, fetcher);
const julyDiagnostic = parseAreraDomesticJuly2026Xlsx(julyPayload.bytes);
const julyRecords = julyDiagnostic.rows.filter((row) => row.section === "DOMESTIC_RESIDENT_BT" && row.componentCode !== null).map((row) => createRegulatoryValue({
  tenantId, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: julyPayload.url, officialIdentifier: "ARERA_DOMESTIC_FREE_2026", publicationDate: "2026-06-26", retrievedAt,
  effectiveFrom: "2026-07-01", effectiveTo: "2026-08-01", componentCode: row.componentCode, customerScope: row.section, originalValue: row.originalValue, originalUnit: row.originalUnit,
  officialName: row.officialLabel, applicationBasis: `Foglio ufficiale \"Luglio 2026\"; ${row.section}; valore della tariffa domestica nel mercato libero`, sourceSha256: sha256(julyPayload.bytes), contractPassThroughRequired: row.componentCode === "DISPATCHING",
}));
const arera587Payload = await fetchOfficialAreraSource(ARERA_587_PDF_URL, fetcher);
const arera587Records = parseArera587Annual2026Values({ retrievedAt, sourceSha256: sha256(arera587Payload.bytes) });
const terna = await importTernaQ3Official({ retrievedAt, fetcher });
const incoming = [...julyRecords, ...arera587Records, ...terna.tideRecords, ...terna.capacityRecords];

const backup = await backupRegulatoryArchive(regulatoryRoot);
const actions = { ARERA_CREATED: 0, ARERA_REUSED: 0, ARERA_CONFLICTS: 0, TERNA_CREATED: 0, TERNA_REUSED: 0, TERNA_CONFLICTS: 0 };
const current = [...before];
const equivalent = (left, right) => left.tenantId === right.tenantId && left.componentCode === right.componentCode && left.customerScope === right.customerScope && left.effectiveFrom === right.effectiveFrom && left.normalizedUnit === right.normalizedUnit && left.normalizedValue === right.normalizedValue;
for (const record of incoming) {
  const authority = record.authority;
  const prefix = authority === "ARERA" ? "ARERA" : "TERNA";
  if (current.some((item) => equivalent(item, record))) { actions[`${prefix}_REUSED`] += 1; continue; }
  const action = await repo.saveRegulatoryValue(record);
  actions[`${prefix}_${action === "CREATED" ? "CREATED" : action === "REUSED" ? "REUSED" : "CONFLICTS"}`] += 1;
  if (action === "CREATED") current.push(record);
}

const after = await repo.getRegulatoryValues(tenantId);
const post = { BILL: await readHash(billMetadata), GME: await readHash(gmeMetadata), CTE: await readHash(cteMetadata), REGULATORY: await readHash(regulatoryFile) };
const duplicateKeys = new Map();
for (const record of after) { const key = [record.tenantId, record.componentCode, record.customerScope, record.effectiveFrom, record.normalizedUnit].join("|"); duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1); }
const completeProvenance = after.filter((record) => Boolean(record.authority && record.publishedBy && record.calculatedBy && record.officialName && record.officialIdentifier && record.sourceReference && record.sourceSha256 && record.originalUnit && record.normalizedUnit && record.effectiveFrom && record.customerScope && record.applicationBasis && typeof record.contractPassThroughRequired === "boolean")).length;

for (const row of julyDiagnostic.rows) console.log(`ROW_INDEX=${row.rowIndex} | OFFICIAL_LABEL=${row.officialLabel} | VALUE_PRESENT=${row.valuePresent ? "SI" : "NO"} | UNIT=${row.originalUnit ?? "-"} | SECTION=${row.section} | VALUE=${row.originalValue ?? "-"}`);
console.log(`ARERA_JULY_ROW_COUNT=${julyDiagnostic.rowCount}`);
console.log(`ARERA_JULY_COMPONENT_COUNT=${julyDiagnostic.componentCount}`);
console.log(`ARERA_JULY_UNMAPPED_COUNT=${julyDiagnostic.unmappedCount}`);
console.log(`ARERA_DOMESTIC_CREATED=${actions.ARERA_CREATED}`);
console.log(`ARERA_DOMESTIC_REUSED=${actions.ARERA_REUSED}`);
console.log(`ARERA_DOMESTIC_CONFLICTS=${actions.ARERA_CONFLICTS}`);
console.log(`ARERA_587_REFERENCE_COUNT=${arera587Records.length}`);
console.log(`TERNA_FRONTEND_SCRIPT_COUNT=${terna.discovery.frontendScriptCount}`);
console.log(`TERNA_NETWORK_ENDPOINT_CANDIDATES=${terna.discovery.networkEndpointCandidates.join(",")}`);
console.log(`TERNA_DISPATCHING_ENDPOINT=${terna.discovery.dispatchingEndpoint}`);
console.log(`TERNA_CAPACITY_ENDPOINT=${terna.discovery.capacityEndpoint}`);
console.log(`TERNA_TIDE_Q3_2026_FOUND=${terna.tideDocument.url ? "SI" : "NO"}`);
console.log(`TERNA_TIDE_REFERENCE_COUNT=${terna.tideRecords.length}`);
console.log(`TERNA_TIDE_VALUE_EXTRACTION=${terna.tideValueExtraction}`);
console.log(`TERNA_CAPACITY_Q3_2026_FOUND=${terna.capacityRecords.length > 0 ? "SI" : "NO"}`);
console.log(`TERNA_CAPACITY_REFERENCE_COUNT=${terna.capacityRecords.length}`);
console.log(`SOURCE_DISCOVERY_REQUIRED_COUNT=${terna.tideValueExtraction === "BLOCKED_NO_TEXT" ? 1 : 0}`);
console.log(`TERNA_CREATED=${actions.TERNA_CREATED}`);
console.log(`TERNA_REUSED=${actions.TERNA_REUSED}`);
console.log(`TERNA_CONFLICTS=${actions.TERNA_CONFLICTS}`);
console.log(`REGULATORY_RECORD_COUNT_BEFORE=${before.length}`);
console.log(`REGULATORY_RECORD_COUNT_AFTER=${after.length}`);
console.log(`REGULATORY_DUPLICATES=${[...duplicateKeys.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0)}`);
console.log(`REGULATORY_PROVENANCE_COMPLETE_COUNT=${completeProvenance}`);
console.log(`REGULATORY_BACKUP_CREATED=${Boolean(backup.path) ? "SI" : "NO"}`);
console.log(`REGULATORY_BACKUP_READABLE=${backup.readable ? "SI" : "NO"}`);
console.log(`REGULATORY_BACKUP_RESTORE_CHECK=${backup.restoreCheck ? "SI" : "NO"}`);
console.log(`BILL_METADATA_SHA256_PRE=${pre.BILL}`); console.log(`BILL_METADATA_SHA256_POST=${post.BILL}`);
console.log(`GME_METADATA_SHA256_PRE=${pre.GME}`); console.log(`GME_METADATA_SHA256_POST=${post.GME}`);
console.log(`CTE_METADATA_SHA256_PRE=${pre.CTE}`); console.log(`CTE_METADATA_SHA256_POST=${post.CTE}`);
console.log(`REGULATORY_METADATA_SHA256_PRE=${pre.REGULATORY}`); console.log(`REGULATORY_METADATA_SHA256_POST=${post.REGULATORY}`);
console.log(`BILL_RUNTIME_UNCHANGED=${pre.BILL === post.BILL ? "SI" : "NO"}`);
console.log(`GME_RUNTIME_UNCHANGED=${pre.GME === post.GME ? "SI" : "NO"}`);
console.log(`CTE_RUNTIME_UNCHANGED=${pre.CTE === post.CTE ? "SI" : "NO"}`);
