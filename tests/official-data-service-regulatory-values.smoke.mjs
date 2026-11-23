import assert from "node:assert/strict";
import { createServiceStore, memoryBackend } from "../services/dati-ufficiali/src/store.ts";
import { createOfficialFetch } from "../services/dati-ufficiali/src/official-fetch.ts";
import { runRegulatoryJob } from "../services/dati-ufficiali/src/regulatory/job.ts";
import { TERNA_CAPACITY_DATASOURCE, TERNA_DISPATCHING_DATASOURCE } from "../app/lib/foundation/terna-electricity-regulatory.ts";

/**
 * Tony 23/11/2026: the Control Room shows the values the service actually acquired. In test mode a Terna-only run reports the
 * capacity charges it read (from the throw-away copy), with document and SHA, and writes nothing into the real archive.
 * Synthetic Terna site and documents; the value is a placeholder, not an official figure.
 */
const NOW = "2026-11-23T13:00:00.000Z";
const pdf = (lines) => new TextEncoder().encode(`%PDF-1.4\n1 0 obj << /Length 10 >>\nstream\n${lines.map((line) => `(${line}) Tj`).join("\n")}\nendstream\nendobj\n%%EOF`);
const routes = new Map([
  ["https://dati.terna.it/corrispettivi", `<html><script src="/bundle.js"></script><div data-ds="${TERNA_DISPATCHING_DATASOURCE}"></div><div data-ds="${TERNA_CAPACITY_DATASOURCE}"></div></html>`],
  ["https://dati.terna.it/bundle.js", `fetch("/api/sitecore/dati/corrispettivi/get")`],
  ["https://dati.terna.it/docs/cm-4q2026.pdf", pdf(["Corrispettivo unitario ore diverse dalle ore di picco del sistema elettrico", "9,876 €/MWh"])],
]);
const fetchImpl = async (input) => {
  const url = new URL(String(input));
  let body = routes.get(`${url.origin}${url.pathname}`);
  if (url.pathname === "/api/sitecore/dati/corrispettivi/get") body = JSON.stringify({ Results: url.searchParams.get("year") === "2026" && url.searchParams.get("datasource") === TERNA_CAPACITY_DATASOURCE ? [{ Title: "Corrispettivo mercato capacità 4Q2026", Url: "/docs/cm-4q2026.pdf", PublicationDate: "16/09/2026" }] : [] });
  if (body === undefined) return new Response("", { status: 404 });
  return new Response(typeof body === "string" ? new TextEncoder().encode(body) : body, { status: 200, headers: { "content-type": "application/octet-stream" } });
};
const backend = memoryBackend([]);
const store = createServiceStore(backend);
const official = createOfficialFetch({ fetchImpl, now: () => NOW, sleep: async () => undefined });
const result = await runRegulatoryJob({ store, fetcher: official.fetch, recorded: official.recorded, tenants: ["tenant_energia-priva"], now: NOW, mode: "DRY_RUN", nextCheckAt: "2026-11-24T03:40:00.000Z", runId: "svc_regulatory_test", only: "terna" });
assert.equal(result.scope, "terna");
assert.equal(result.tenants[0].arera, "SKIPPED");
const q4 = result.acquired.filter((value) => value.identifier === "TERNA_CAPACITY_MARKET_2026Q4");
assert.ok(q4.length > 0, JSON.stringify(result));
assert.ok(q4.every((value) => value.value === 9.876 && value.unit === "EUR/MWH" && value.authority === "TERNA" && value.effectiveFrom === "2026-10-01" && value.source.endsWith("cm-4q2026.pdf") && /^[0-9a-f]{64}$/.test(value.sha256)));
assert.deepEqual(backend.writes ?? [], [], "test mode: nothing written into the real archive");
console.log("official-data-service-regulatory-values: OK");
