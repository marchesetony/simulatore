import assert from "node:assert/strict";
import { normalizeProviderExtraction } from "../app/lib/cte/ingestion.ts";
import { buildAuthoritativeCteContract, cteApprovalGate, passThroughReadingGaps } from "../app/lib/cte/review.ts";

// Tony (27/10) sent the BPower Be Smart CTE (06/11/2025 - 31/12/2026): "devi adeguare il sistema a leggere tutte le cte in
// modo corretto ... ogni mese cambiano e non posso permettere di avere letture errate". The paragraphs below are copied
// from that CTE; the reading must find dispatching, capacity (TIV 34.8 bis + Capacity Market libero) and losses wherever
// the AI quoted them, and a reading that misses one must not be approvable.
const DISPATCHING = "È prevista l'applicazione dei corrispettivi di dispacciamento di cui all'Art. 24 del TIS e periodicamente aggiornati dall'ARERA e da Terna, incrementati del fattore per tenere conto delle perdite di energia elettrica sulle reti di trasmissione e di distribuzione pubblicato nella Tabella 4, colonna A allegata al TIS, e attualmente pari a 0,01155 Eur/kWh";
const CAPACITY = "e del Corrispettivo mercato capacità di cui al comma 34.8 bis del TIV così come definito ed aggiornato dall'ARERA e attualmente pari a 0,01349 Eur/kWh in bassa tensione e pari a 0,0032 Eur/kWh nelle ore di picco e pari a 0,065 Eur/kWh per i clienti in media tensione. È inoltre prevista l'applicazione del corrispettivo Capacity Market libero pari a 0,0075 Eur/kWh al lordo delle perdite di rete.";
const field = (path, value, sourceText = typeof value === "string" ? value : "evidenza") => ({ path, value, confidence: 0.98, sourcePage: 1, sourceText, status: value === null ? "NOT_FOUND" : "CONFIRMED" });
const base = (passThroughText, variableText) => [
  field("supplier.name", "BPower Energia S.p.A."), field("supplier.supplierId", "01867000851", "P.IVA 01867000851"), field("offer.name", "Be Smart"), field("offer.code", "003888ESVFL04XXXXXXXXXBSMART1125"),
  field("validity.periodStart", "2025-11-06"), field("validity.periodEnd", "2026-12-31"), field("eligibility.customerTypes", "Clienti Finali Non Domestici con utenze Altri Usi Business"), field("eligibility.voltageLevels", "bassa o media tensione"),
  field("pricing.mode", "Prezzo indicizzato al PUN"), field("pricing.reference", "PUN"), field("pricing.spread.amount", "0,01 Eur/kWh", "il corrispettivo fisso d'acquisto, bloccato per tutta la durata dell'offerta, pari a 0,01 Eur/kWh"), field("currency", "EUR"), field("taxTreatment", "al netto di IVA e/o imposte"),
  field("commercialTerms.fixedFees", "Quota fissa business pari a 15 €/mese"),
  field("commercialTerms.variableFees", "Commercializzazione pari a 0,002 €/kWh al netto delle perdite di rete", variableText),
  field("commercialTerms.imbalance", "Sbilanciamento pari a 0,005 €/kWh al netto delle perdite di rete"),
  field("commercialTerms.oneOffFees", "valore una tantum gestione APP e servizi di €1,50"),
  field("commercialTerms.passThroughComponents", [], passThroughText),
];
const build = (fields, id) => {
  const extraction = normalizeProviderExtraction({ schemaVersion: 1, documentType: "CTE", vector: "EE", fields, extractionNotes: [] }, "tenant_besmart");
  const record = { ingestionId: `cte-besmart-${id}`, documentId: `doc-besmart-${id}`, tenantId: "tenant_besmart", documentType: "CTE", vector: "EE", fields: extraction.fields, status: "REVIEW_REQUIRED", candidate: null, reviewedCandidate: null };
  return { record, contract: buildAuthoritativeCteContract(record) };
};
const expectComplete = ({ contract }) => {
  const terms = contract.commercialTerms;
  assert.ok(terms.dispatchingReference, "dispacciamento Art. 24 TIS letto");
  assert.equal(terms.dispatchingReference.snapshotValue, 0.01155);
  assert.ok(terms.lossReference, "perdite Tabella 4, colonna A allegata al TIS lette");
  const capacity = terms.capacityMarketSchedule ?? [];
  assert.deepEqual(capacity.map((entry) => [entry.mode, entry.timeClass, entry.voltageScope ?? null, entry.value]), [
    ["OFFICIAL_PASS_THROUGH", "ALL", "LV", 0.01349], ["OFFICIAL_PASS_THROUGH", "PEAK", null, 0.0032], ["OFFICIAL_PASS_THROUGH", "ALL", "MV", 0.065], ["FIXED_VALUE", "CAPACITY_MARKET_LIBERO", null, 0.0075],
  ]);
  assert.equal(capacity[3].lossTreatment, "GROSS_OF_LOSSES");
  assert.equal(terms.imbalance.status, "DECLARED");
};
// 1. The AI quoted the whole section in the pass-through field.
expectComplete(build(base(`1.3 Oneri di dispacciamento ${DISPATCHING}, ${CAPACITY}`, "Commercializzazione pari a 0,002 €/kWh al netto delle perdite di rete"), "full"));
// 2. The AI cut the pass-through quote short and put the capacity paragraph under the variable fees: still read.
const split = build(base(DISPATCHING, `Commercializzazione pari a 0,002 €/kWh al netto delle perdite di rete; ${CAPACITY}`), "split");
expectComplete(split);
assert.deepEqual(passThroughReadingGaps(split.record.fields, split.contract), []);
// 3. The text names dispatching and capacity in words the reading does not recognise: approval is blocked, with the reason.
const vague = build(base("Oneri di dispacciamento e mercato della capacità secondo la normativa vigente", "Commercializzazione pari a 0,002 €/kWh"), "vague");
assert.deepEqual(passThroughReadingGaps(vague.record.fields, vague.contract), ["il dispacciamento", "il mercato della capacità"]);
const gate = cteApprovalGate({ ...vague.record, candidate: vague.contract });
assert.equal(gate.approvalReady, false);
assert.ok(gate.blockers.some((blocker) => /dispacciamento, il mercato della capacità/.test(blocker.label)));
// Tony (31/10, CTE BE Family CASA PROTETTA: "continua a non leggere bene e a restituire errori"): the CTE bills the ARERA
// CDISPD for dispatching and capacity; naming it is enough, the engine applies the official value.
const cdispd = build(base("Il fornitore fatturerà un ulteriore corrispettivo CDISPD a copertura dei costi del servizio di dispacciamento e del mercato della capacità, espresso in €/kWh, così come determinato e aggiornato dall'Autorità, in base all'articolo 48 del TIV.", "Commercializzazione pari a 0,002 €/kWh"), "cdispd");
assert.deepEqual(passThroughReadingGaps(cdispd.record.fields, cdispd.contract), []);
assert.ok(!cteApprovalGate({ ...cdispd.record, candidate: cdispd.contract }).blockers.some((blocker) => /non li ha riconosciuti/.test(blocker.label)), "no reading blocker for a CDISPD CTE");
// 4. A CTE that includes them in the energy price is not blocked.
const included = build(base("Il prezzo è comprensivo degli oneri di dispacciamento e del mercato della capacità", "Commercializzazione pari a 0,002 €/kWh"), "included");
assert.deepEqual(passThroughReadingGaps(included.record.fields, included.contract), []);
// Tony (28/10, BPower Casa Protetta): "le cte ci sono come mai non li vede". The customer kinds are read one by one, so
// "domestici e non domestici" admits both and a domestic offer is never read as business only.
const customerOf = (text, id) => build(base(`1.3 Oneri di dispacciamento ${DISPATCHING}, ${CAPACITY}`, "Commercializzazione pari a 0,002 €/kWh al netto delle perdite di rete").map((item) => item.path === "eligibility.customerTypes" ? field(item.path, text) : item), id).contract.eligibility.customerTypes;
assert.deepEqual(customerOf("Clienti Finali Non Domestici con utenze Altri Usi Business", "c1"), ["NON_RESIDENTIAL"]);
assert.deepEqual(customerOf("Clienti domestici residenti e non residenti", "c2"), ["RESIDENTIAL"]);
assert.deepEqual([...customerOf("Clienti domestici e non domestici", "c3")].sort(), ["NON_RESIDENTIAL", "RESIDENTIAL"]);
assert.deepEqual(customerOf("Uso domestico", "c4"), ["RESIDENTIAL"]);
// Tony (28/10, BE Family Casa Protetta): a spread "riportato in tabella al lordo delle perdite di rete" is read as such.
const grossFields = base(`1.3 Oneri di dispacciamento ${DISPATCHING}, ${CAPACITY}`, "Commercializzazione pari a 0,002 €/kWh al netto delle perdite di rete").map((item) => item.path === "pricing.spread.amount" ? field(item.path, "0,03 €/kWh", "somma del prezzo PUN Index GME e di uno spread in €/kWh definito dal venditore e riportato in tabella al lordo delle perdite di rete") : item);
assert.equal(build(grossFields, "gross").contract.pricing.spread.lossTreatment, "GROSS_OF_LOSSES");
assert.equal(build(base(`1.3 Oneri di dispacciamento ${DISPATCHING}, ${CAPACITY}`, "Commercializzazione pari a 0,002 €/kWh al netto delle perdite di rete"), "net").contract.pricing.spread.lossTreatment, undefined);
console.log("CTE_BE_SMART_READING=PASS");
