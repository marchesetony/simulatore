import assert from "node:assert/strict";
import { importTernaCapacityQuarter } from "../app/lib/foundation/terna-electricity-regulatory.ts";

/**
 * Tony 23/11/2026: Terna capacity 2026Q4 failed with TERNA_CAPACITY_VALUE_NOT_FOUND in the official data service, although the
 * same document had been read on 28/10 from its literal strings. When the text layer does not carry the charge, the literal
 * strings are read too. Synthetic PDF: the page shows only a title, the charge sits in a literal string outside the page.
 */
const page = "BT /F1 12 Tf (Corrispettivi mercato della capacita) Tj ET";
const extra = "(Corrispettivo unitario ore diverse dalle ore di picco del sistema elettrico) Tj (9,876 EUR/MWh) Tj";
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> >>",
  `<< /Length ${page.length} >>\nstream\n${page}\nendstream`,
  `<< /Length ${extra.length} >>\nstream\n${extra}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
let body = "%PDF-1.4\n"; const offsets = [];
objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
const xref = body.length;
body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const pdf = new TextEncoder().encode(body);

const discovery = { capacityEndpoint: "https://dati.terna.it/api/sitecore/dati/corrispettivi/get", capacityDatasource: "X", dispatchingEndpoint: "https://dati.terna.it/api/sitecore/dati/corrispettivi/get", dispatchingDatasource: "Y" };
const listing = JSON.stringify({ Results: [{ Title: "Corrispettivi capacità 4° trimestre 2026", Url: "/docs/cm-4q2026.pdf", PublicationDate: "16/09/2026" }] });
const fetcher = async (input) => {
  const url = String(input);
  const bytes = url.includes("/api/") ? new TextEncoder().encode(listing) : url.endsWith("cm-4q2026.pdf") ? pdf : null;
  if (!bytes) return { ok: false, status: 404, url, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "", headers: new Headers() };
  return { ok: true, status: 200, url, headers: new Headers({ "content-type": url.includes("/api/") ? "application/json" : "application/pdf" }), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => new TextDecoder().decode(bytes) };
};
const result = await importTernaCapacityQuarter({ tenantId: "tenant_test", retrievedAt: "2026-11-23T08:00:00.000Z", quarter: { year: 2026, quarter: 4, effectiveFrom: "2026-10-01", effectiveTo: "2027-01-01" }, fetcher, discovery });
assert.deepEqual([...new Set(result.records.map((record) => record.originalValue))], [9.876]);
console.log("terna-capacity-literal-fallback: OK");
