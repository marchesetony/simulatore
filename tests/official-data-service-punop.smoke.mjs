import assert from "node:assert/strict";
import { createServiceStore, memoryBackend } from "../services/dati-ufficiali/src/store.ts";
import { createOfficialFetch } from "../services/dati-ufficiali/src/official-fetch.ts";
import { runGmeJob, gmeSourcePages } from "../services/dati-ufficiali/src/gme/job.ts";
import { findPunopPdf, readPunopPdf, readPunopText, GME_PUNOP_300_PAGE } from "../services/dati-ufficiali/src/gme/punop.ts";
import { syntheticGmePunopPdf } from "./fixtures/official-data-service/synthetic-gme-punop-pdf.mjs";

/**
 * Tony (22/11/2026): the parameter of art. 5.2 of ARERA deliberation 300/05 is a GME series of its own. It is acquired and
 * checked month by month from the GME page, kept with its own identifier, meaning, period, unit and document, never written
 * into the PUN archive the engine reads, and its failures never block the PUN. Synthetic documents only; no network.
 */
const NOW = "2026-11-22T05:20:00.000Z";
const IT = { "2026-05": "Maggio 2026", "2026-06": "Giugno 2026", "2026-07": "Luglio 2026", "2026-08": "Agosto 2026", "2026-09": "Settembre 2026", "2026-10": "Ottobre 2026" };
const LABEL = { "2026-05": "PUNopMag2026", "2026-06": "PUNopGiu2026", "2026-07": "PUNopLug2026", "2026-08": "PUNopAgo2026", "2026-09": "PUNopSet2026", "2026-10": "PUNopOtt2026" };
const DATE = { "2026-05": "20260601", "2026-06": "20260703", "2026-07": "20260803", "2026-08": "20260902", "2026-09": "20260930", "2026-10": "20261103" };
const VALUE = { "2026-05": "122,83" }; // only May is a value Tony verified on the official PDF; other months are left unpublished here
const fileUrl = (month) => `https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT/${DATE[month]}Indice%205.2%20delibera%20ARERA%20300.05%20-%20${IT[month].replace(" ", "%20")}.pdf`;

function site({ months = ["2026-05"], pdf = {} } = {}) {
  const files = new Map();
  const links = months.map((month) => `<a href="${fileUrl(month).replace("https://gme.mercatoelettrico.org", "")}">Prezzo medio delibera ARERA 300/05 - ${IT[month]}</a>`).join("");
  files.set(GME_PUNOP_300_PAGE, { body: new TextEncoder().encode(`<html><h1>Prezzo medio delibera 300/05</h1>${links}</html>`), type: "text/html" });
  for (const month of months) files.set(fileUrl(month), { body: pdf[month] ?? syntheticGmePunopPdf({ month: IT[month], label: LABEL[month], value: VALUE[month] }), type: "application/pdf" });
  return async (url, init = {}) => {
    const file = files.get(url);
    if (!file) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    if ((init.method ?? "GET") === "HEAD") return new Response(null, { status: 200, headers: { "content-type": file.type } });
    return new Response(file.body, { status: 200, headers: { "content-type": file.type } });
  };
}

// 1. Reader on the wording of the official PDF (May 2026, 122,83 €/MWh, verified by Tony on the GME PDF).
{
  const text = "Per il mese il valore del parametro di cui all'articolo 5.2 della Delibera dell'Autorità di Regolazione per Energia, Reti e Ambiente n. 300/05 è pari a: Maggio 2026 PUNopMag2026 122,83 €/MWh";
  const reading = readPunopText(text, "2026-05");
  assert.equal(reading.value, 122.83); assert.equal(reading.label, "PUNopMag2026"); assert.ok(reading.checks.every((check) => check.ok));
  assert.equal(readPunopText(text, "2026-06").value, null, "the May document is never the June value");
  assert.equal(readPunopText(text.replace("PUNopMag2026", "PUNopGiu2026"), "2026-05").value, null, "label of another month");
  assert.equal(readPunopText(text.replace("articolo 5.2", "articolo 6"), "2026-05").value, null, "another parameter");
  assert.equal(readPunopText(text.replace("€/MWh", "€/kWh"), "2026-05").value, null, "unit must be €/MWh");
  assert.equal(readPunopText(`${text} 119,35 €/MWh`, "2026-05").value, null, "two different values: ambiguous");
  assert.equal(readPunopPdf(syntheticGmePunopPdf(), "2026-05").value, 122.83);
  assert.equal(readPunopPdf(syntheticGmePunopPdf({ article: false }), "2026-05").value, null);
  assert.equal(readPunopPdf(new TextEncoder().encode("<html>404</html>"), "2026-05").value, null);
}

// 2. Link on the GME page, both hosts, encoded spaces; nothing found for an unpublished month.
{
  const html = `<a href="https://www.mercatoelettrico.org/Portals/0/Documents/it-IT/20260601Indice%205.2%20delibera%20ARERA%20300.05%20-%20Maggio%202026.pdf">Prezzo medio delibera ARERA 300/05 - Maggio 2026</a><a href="https://evil.example/x.pdf">Prezzo medio delibera ARERA 300/05 - Giugno 2026</a>`;
  assert.equal(findPunopPdf(html, "2026-05"), "https://www.mercatoelettrico.org/Portals/0/Documents/it-IT/20260601Indice%205.2%20delibera%20ARERA%20300.05%20-%20Maggio%202026.pdf");
  assert.equal(findPunopPdf(html, "2026-06"), null, "a link outside the GME hosts is ignored");
  assert.equal(findPunopPdf(html, "2026-07"), null);
}

// 3. Dry run: value reported for May, other months not yet published, nothing written except nothing; PUN archive untouched.
{
  const backend = memoryBackend();
  const official = createOfficialFetch({ fetchImpl: site(), now: () => NOW, sleep: async () => undefined });
  const months = await runGmeJob({ store: createServiceStore(backend), fetcher: official.fetch, recorded: official.recorded, tenants: ["tenant_piattaforma"], now: NOW, mode: "DRY_RUN", nextCheckAt: NOW });
  const may = months.find((item) => item.month === "2026-05");
  assert.equal(may.punop.value, 122.83); assert.equal(may.punop.seriesId, "ARERA_300_05_ART_5_2"); assert.equal(may.punop.unit, "EUR_PER_MWH");
  assert.equal(may.punop.conserved, null, "dry run: not conserved");
  assert.notEqual(may.state, "READY_DRY_RUN", "the PUN of May is not completed or replaced by the 300/05 parameter");
  assert.ok(!may.errors.some((error) => /PUNOP/.test(error)));
  assert.equal(may.bands, null); assert.equal(may.monthly, null);
  assert.deepEqual(months.find((item) => item.month === "2026-06").punop.errors, ["GME_PUNOP_NOT_PUBLISHED_YET"]);
  assert.equal(backend.writes.length, 0, "a dry run writes nothing here");
}

// 4. Publishing: the document is conserved with its own kind and values; never a market archive record.
{
  const backend = memoryBackend();
  const official = createOfficialFetch({ fetchImpl: site(), now: () => NOW, sleep: async () => undefined });
  const months = await runGmeJob({ store: createServiceStore(backend), fetcher: official.fetch, recorded: official.recorded, tenants: ["tenant_piattaforma"], now: NOW, mode: "PUBLISH", nextCheckAt: NOW });
  const may = months.find((item) => item.month === "2026-05");
  assert.ok(may.punop.conserved?.documentId.startsWith("svcdoc_GME_ARERA_300_05_PDF_2026-05_"));
  const docs = [...backend.rows.values()].filter((row) => row.collection === "official-service-documents" && row.payload.kind === "GME_ARERA_300_05_PDF");
  assert.equal(docs.length, 1); assert.equal(docs[0].payload.values.value, 122.83); assert.equal(docs[0].payload.values.seriesId, "ARERA_300_05_ART_5_2");
  assert.equal([...backend.rows.values()].filter((row) => row.collection === "market-archives").length, 0, "never in the PUN archive");
}

// 5. A broken 300/05 document is an error of its own series only.
{
  const official = createOfficialFetch({ fetchImpl: site({ pdf: { "2026-05": syntheticGmePunopPdf({ label: "PUNopApr2026" }) } }), now: () => NOW, sleep: async () => undefined });
  const months = await runGmeJob({ store: createServiceStore(memoryBackend()), fetcher: official.fetch, recorded: official.recorded, tenants: ["tenant_piattaforma"], now: NOW, mode: "DRY_RUN", nextCheckAt: NOW });
  const may = months.find((item) => item.month === "2026-05");
  assert.equal(may.punop.value, null); assert.match(may.punop.errors[0], /^GME_PUNOP_CHECKS:.*LABEL/);
  assert.ok(!may.errors.some((error) => /PUNOP/.test(error)), "never mixed into the PUN errors");
}

// 6. The three GME pages named by Tony.
{
  const pages = await gmeSourcePages(createOfficialFetch({ fetchImpl: site(), now: () => NOW, sleep: async () => undefined }).fetch, []);
  assert.deepEqual(pages.map((page) => page.id), ["GME_PUN_BANDS", "ARERA_300_05_ART_5_2", "GME_PUN_INDEX_GME"]);
  assert.deepEqual(pages.map((page) => page.reachable), [false, true, false]);
}

console.log("official-data-service-punop smoke: OK");
