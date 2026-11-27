import assert from "node:assert/strict";
import { MAX_OUTER_UNCOMPRESSED_BYTES, MAX_XLSX_BYTES, MAX_XLSX_UNCOMPRESSED_BYTES } from "../app/lib/market/gme-historical-archive.ts";

// Tony (6/11, "PUN con errori: GME_ZIP_UNCOMPRESSED_LIMIT" for every month from October): the yearly PT15 workbook decompresses
// to well over 150 MB by autumn. The limits must cover a full year of 15-minute rows (sheet XML compresses about 10-15x).
assert.ok(MAX_XLSX_UNCOMPRESSED_BYTES >= MAX_XLSX_BYTES * 15, "a full-year workbook must fit");
assert.ok(MAX_OUTER_UNCOMPRESSED_BYTES >= 150 * 1024 * 1024);
console.log("gme archive limits: ok");
