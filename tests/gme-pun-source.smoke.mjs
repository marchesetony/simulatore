import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GmePunSourceAdapter, parseGmeOfficialPublication, sameGmeOfficialRecord } from "../app/lib/market/gme-pun-source.ts";

const publication = await readFile(new URL("./fixtures/gme-july-2026-publication.txt", import.meta.url), "utf8");
const sourceReference = "https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT/20260803PrezzomedioperfasceLuglio2026.pdf";
const input = { tenantId: "tenant_test", referenceMonth: "2026-07", publicationText: publication, sourceReference, publishedAt: "2026-08-03", retrievedAt: "2026-08-17T10:00:00.000Z" };
const parsed = parseGmeOfficialPublication(input);
assert.deepEqual([parsed.f1?.value, parsed.f2?.value, parsed.f3?.value], [154.2, 169.38, 152.26]);
assert.equal(parsed.monthly, undefined);
assert.equal(parsed.source.authority, "GME");
assert.equal(parsed.source.sourceType, "OFFICIAL");
console.log("GME_PUBLICATION_EXACT_BAND_ROWS=OK");

const differentRetrievedAt = parseGmeOfficialPublication({ ...input, retrievedAt: "2026-08-17T14:00:00.000Z" });
assert.equal(sameGmeOfficialRecord(parsed, differentRetrievedAt), true);
console.log("IDEMPOTENCE_SEMANTIC_COMPARISON=OK");

const records = [];
const repository = { async get(_tenantId, archiveId) { return records.find((record) => record.archiveId === archiveId) ?? null; }, async list() { return records; }, async save(record) { records.push(record); } };
const adapter = new GmePunSourceAdapter(repository, {});
const first = await adapter.importOfficialPublication(input);
assert.equal(first.action, "CREATED");
assert.equal(records.length, 1);
const second = await adapter.importOfficialPublication({ ...input, retrievedAt: "2026-08-17T14:00:00.000Z" });
assert.equal(second.action, "REUSED");
assert.equal(records.length, 1);
console.log("FIRST_ACTION=CREATED");
console.log("SECOND_ACTION=REUSED");
console.log("RECORD_COUNT=1");

const conflict = await adapter.importOfficialPublication({ ...input, retrievedAt: "2026-08-17T15:00:00.000Z", publicationText: publication.replace("154,20", "999,99") });
assert.equal(conflict.action, null);
assert.equal(conflict.reason, "GME_RECORD_CONFLICT");
assert.equal(records.length, 1);
console.log("REAL_CONFLICT_TEST=OK");

const wrongMonth = () => parseGmeOfficialPublication({ ...input, publicationText: "Giugno 2026\nPrezzo medio per fasce (EUR/MWh)\nF1 154,20 EUR/MWh\nF2 169,38 EUR/MWh\nF3 152,26 EUR/MWh" });
assert.throws(wrongMonth, /GME_PUBLICATION_MONTH_MISMATCH/);
console.log("WRONG_MONTH_NEGATIVE_TEST=OK");

const unsafeShape = () => parseGmeOfficialPublication({ ...input, publicationText: "Luglio 2026\nF1 F2 F3\n154,20 EUR/MWh 169,38 EUR/MWh 152,26 EUR/MWh" });
assert.throws(unsafeShape, /GME_PUBLICATION_VALUES_MISSING/);
console.log("UNSAFE_LAST_THREE_VALUES_FALLBACK_REMOVED=OK");

const blocked = await new GmePunSourceAdapter(repository, { GME_PUN_SOURCE_MODE: "GME_API" }).importOfficialPublication(input);
assert.equal(blocked.status, "SOURCE_BLOCKED");
assert.equal(blocked.reason, "GME_API_CREDENTIALS_NOT_CONFIGURED");
console.log("GME_API_CREDENTIALS_FAIL_CLOSED=OK");
console.log("gme pun source smoke: ok");
