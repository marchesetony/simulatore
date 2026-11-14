import assert from "node:assert/strict";
import { tryBuildAuthoritativeCteContract } from "../app/lib/cte/review.ts";
import { validateCteContract } from "../app/lib/cte/validation.ts";
import { annualSaving } from "../app/lib/quote/annual-saving.ts";
import { withOneOffRepair } from "../app/lib/cte/one-off-repair.ts";

// Tony (1/11): "perche la be family fast costa più della casa protetta, pur avendo una pcv più bassa?". The two BPower CTEs
// differ only in the PCV (13,00 vs 11,90 €/mese) and both charge "una tantum gestione APP e servizi … prima bolletta di
// €1,50"; Casa Protetta also has a 69 € early-exit penalty for its polizza, and the one-off was dropped with it.
const field = (path, value, sourceText = String(value), status = "CONFIRMED") => ({ path, value, confidence: 0.99, sourcePage: 2, sourceText, status });
const duration = { value: 12, unit: "MONTHS", sourceText: "12 mesi dalla data di sottoscrizione" };
const exitFee = { amount: 69, currency: "EUR", condition: "EARLY_EXIT_BEFORE_DURATION", durationReference: duration, sourceText: "penale per l'opzione copertura polizza CASA PROTETTA di € 69,00" };
const fields = (oneOff) => [
  field("supplier.name", "BPower Energia S.p.A."), field("supplier.supplierId", "Partita IVA 01867000851"), field("offer.name", "BE Family CASA PROTETTA"), field("offer.code", "003888ESVFL02XXXXXXXCASAPROTETTA"),
  field("validity.periodStart", "01/04/2026"), field("validity.periodEnd", "31/12/2026"), field("expiry.date", "31/12/2026"), field("eligibility.customerTypes", "Clienti domestici"), field("eligibility.voltageLevels", "BT"),
  field("pricing.mode", "Prezzo fisso"), field("pricing.fixedPrice.amount", "0,12 €/kWh"), field("currency", "EUR"), field("taxTreatment", "IVA e imposte escluse"),
  field("commercialTerms.fixedFees", "156 €/POD/anno; 13 €/mese", "Totale corrispettivi fissi del venditore 156 €/POD/anno, fatturato in quote mensili pari a 13 €/mese"),
  field("commercialTerms.variableFees", null, null, "NOT_FOUND"), field("commercialTerms.imbalance", null, null, "NOT_FOUND"), field("commercialTerms.commercialDiscounts", null, null, "NOT_FOUND"),
  oneOff === null ? field("commercialTerms.oneOffFees", null, null, "NOT_FOUND") : field("commercialTerms.oneOffFees", oneOff, `Verrà applicato un valore una tantum gestione APP e servizi inserito sulla prima bolletta di €${String(oneOff).replace(".", ",")}`),
  field("commercialTerms.economicDuration", duration), field("commercialTerms.exitFee", exitFee),
];
const build = (oneOff) => tryBuildAuthoritativeCteContract({ ingestionId: "cte-casa-protetta", documentId: "doc-casa-protetta", tenantId: "tenant_bpower", vector: "EE", documentType: "CTE", fields: fields(oneOff) });

const casaProtetta = build("1,50 €");
assert.equal(casaProtetta.errorCode, null, JSON.stringify(casaProtetta));
assert.equal(casaProtetta.contract.commercialTerms.oneOffFees.length, 1, "the 1,50 € of the first bill is kept beside the exit penalty");
assert.equal(casaProtetta.contract.commercialTerms.oneOffFees[0].amount, 1.5);
assert.doesNotThrow(() => validateCteContract(casaProtetta.contract), "the stored contract stays valid for every deployment");

const penaltyTwice = build("69,00 €");
assert.equal(penaltyTwice.contract.commercialTerms.oneOffFees.length, 0, "the exit penalty read again as one-off is not money of the first bill");
assert.equal(penaltyTwice.contract.commercialTerms.exitFee.amount, 69);
assert.equal(build(null).contract.commercialTerms.exitFee.amount, 69, "without a one-off the exit penalty stays");

// One month, IVA 10%, 12× annual consumption: Fast saves 1,10 €/mese of PCV and pays 1,50 € once.
const base = { currentTotal: 174.2, billFixed: 13, oneOff: 1.5, vat: 1.1, months: 1, factor: 12 };
const cp = annualSaving({ ...base, savings: 174.2 - 171.37, offerFixed: 13 });
const fast = annualSaving({ ...base, savings: 174.2 - 170.16, offerFixed: 11.9 });
assert.ok(Math.abs(fast.saving - cp.saving - 1.1 * 12 * 1.1) < 0.01, `lower PCV, higher annual saving (${fast.saving} vs ${cp.saving})`);
const noOneOff = annualSaving({ ...base, oneOff: 0, savings: 174.2 - 169.72, offerFixed: 13 });
assert.ok(Math.abs(noOneOff.saving - cp.saving - 1.65) < 0.01, "the one-off counts once a year, not ×12");

// Tony (1/11): "non vorrei che lo stesso errore lo rifacciamo anche su altre cte, di nuovi clienti o anche su quelle che
// abbiamo". A CTE approved before the fix gets its one-off back from its stored reading on every read, without re-upload.
const old = { ...casaProtetta.contract, cteId: "cte-casa-protetta", commercialTerms: { ...casaProtetta.contract.commercialTerms, oneOffFees: [], exitFee } };
const stored = { archiveId: "arc-1", tenantId: "tenant_bpower", cteId: old.cteId, vector: "EE", versions: [{ versionId: "v1", versionNumber: 1, supersedesVersionId: null, status: "APPROVED", contract: old, createdAt: "2026-10-31T00:00:00.000Z" }] };
const saved = [];
const raw = { get: async () => stored, list: async () => [stored], save: async (record) => { saved.push(record); } };
const readings = { get: async (tenantId, id) => id === "cte-casa-protetta" && tenantId === "tenant_bpower" ? { payload: { documentId: id, ingestionId: id, vector: "EE", documentType: "CTE", fields: fields("1,50 €") } } : null };
const repaired = withOneOffRepair(raw, readings);
const [listed] = await repaired.list("tenant_bpower");
assert.equal(listed.versions[0].contract.commercialTerms.oneOffFees[0].amount, 1.5, "the stored Casa Protetta gets its 1,50 € back");
assert.equal(listed.versions[0].contract.commercialTerms.exitFee, undefined);
assert.doesNotThrow(() => validateCteContract(listed.versions[0].contract));
assert.equal((await repaired.get("tenant_bpower", "arc-1")).versions[0].contract.commercialTerms.oneOffFees.length, 1);
await repaired.save(listed);
assert.equal(saved[0].versions[0].contract, old, "the stored version is written back as it was: versions are immutable");
const unreadable = withOneOffRepair(raw, { get: async () => null });
assert.equal((await unreadable.list("tenant_bpower"))[0].versions[0].contract, old, "without its reading the CTE stays as stored");
console.log("one-off with exit fee ok");
