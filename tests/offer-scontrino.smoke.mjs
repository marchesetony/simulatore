import assert from "node:assert/strict";
import { billedMonths, offerScontrino, pairScontrini } from "../app/lib/quote/offer-scontrino.ts";

// Tony (1/11, "queste le voci che dobbiamo avere visibili nell'offerta come una fattura reale, poi il dettaglio con il
// paragone"): the offer as the ARERA "Scontrino dell'energia" (facsimile Figura 1: 400 kWh x 0,18 = 72,00 of which 44,00
// vendita and 28,00 rete e oneri; 2 mesi x 7,00 = 14,00; 3 kW per 2 mesi x 2,00 = 12,00; bonus −30,00; accise e IVA 16,79).
const q = (key, offer, offerSeller = null) => ({ key, label: key, basis: "", current: null, offer, difference: null, currentSeller: null, offerSeller, details: [] });
const quotas = [q("CONSUMPTION", 72, 44), q("FIXED", 14, 10), q("POWER", 12, 0), q("BONUS", -30), q("TAXES", 16.79)];
const lines = offerScontrino({ quotas, offerTotal: 84.79, taxesIncluded: true, vector: "EE", quantity: 400, months: 2, powerKw: 3 });
const view = lines.map((line) => [line.kind, line.label || line.quantity, line.price ?? null, line.amount]);
assert.deepEqual(view, [
  ["section", "Quota per consumi", null, null],
  ["main", "400 kWh", "0,180000 €/kWh", 72],
  ["sub", "di cui spesa per la vendita di energia elettrica", "0,110000 €/kWh", 44],
  ["sub", "di cui spesa per la rete e gli oneri generali di sistema", "0,070000 €/kWh", 28],
  ["section", "Quota fissa e Quota potenza", null, null],
  ["main", "2 mesi", "7,00 €/mese", 14],
  ["sub", "di cui spesa per la vendita di energia elettrica", "5,00 €/mese", 10],
  ["sub", "di cui spesa per la rete e gli oneri generali di sistema", "2,00 €/mese", 4],
  ["main", "3 kW per 2 mesi", "2,00 €/kW/mese", 12],
  ["sub", "di cui spesa per la rete e gli oneri generali di sistema", "2,00 €/kW/mese", 12],
  ["item", "Bonus sociale", null, -30],
  ["item", "Accise e IVA", null, 16.79],
  ["total", "Totale bolletta", null, 84.79],
]);
// The company discount stays visible as its own line; the consumption quota is shown at full price.
const discounted = offerScontrino({ quotas: [q("CONSUMPTION", 62, 34)], offerTotal: null, taxesIncluded: false, vector: "EE", quantity: 400, months: 1, powerKw: null, discount: -10 });
assert.equal(discounted.find((line) => line.kind === "main").amount, 72);
assert.deepEqual(discounted.filter((line) => line.kind === "item").map((line) => [line.label, line.amount]), [["Sconto commerciale aziendale", -10]]);
assert.equal(discounted.at(-1).label, "Totale imposte escluse");
assert.equal(discounted.at(-1).amount, 62);
assert.equal(billedMonths("2026-07-01", "2026-08-01"), 1);
assert.equal(billedMonths("2026-07-01", "2026-09-01"), 2);
assert.equal(billedMonths("2026-06-16", "2026-07-01"), 0.5);
console.log("OFFER_SCONTRINO=PASS");

// The same lines travel to the proposal PDF through the screen's presentation.
const { parseProposalPresentation } = await import("../app/lib/proposal/presentation.ts");
const parsed = parseProposalPresentation({ offerSupplier: "S", offerName: "N", rows: [], scontrino: lines });
assert.equal(parsed.scontrino.length, lines.length);
assert.deepEqual(parsed.scontrino[1], { kind: "main", label: "", quantity: "400 kWh", price: "0,180000 €/kWh", amount: 72 });
assert.throws(() => parseProposalPresentation({ scontrino: [{ kind: "bogus", label: "x", amount: 1 }] }));
console.log("OFFER_SCONTRINO_PDF=PASS");

// Tony (1/11, "dove è lo scontrino della fattura?"): the uploaded bill's own scontrino from the same quotas (bill side),
// next to the offer's; the company discount never touches the bill side.
{
  const both = (key, current, currentSeller, offer, offerSeller) => ({ key, label: key, basis: "", current, offer, difference: null, currentSeller, offerSeller, details: [] });
  const billSide = offerScontrino({ quotas: [both("CONSUMPTION", 797.67, 668.46, 700, 600), both("TAXES", 100, null, 90, null)], offerTotal: 897.67, taxesIncluded: true, vector: "EE", quantity: 2642, months: 1, powerKw: null, side: "current", discount: -10 });
  assert.deepEqual(billSide.map((line) => [line.kind, line.label || line.quantity, line.price ?? null, line.amount]), [
    ["section", "Quota per consumi", null, null],
    ["main", "2.642 kWh", "0,301919 €/kWh", 797.67],
    ["sub", "di cui spesa per la vendita di energia elettrica", "0,253013 €/kWh", 668.46],
    ["sub", "di cui spesa per la rete e gli oneri generali di sistema", "0,048906 €/kWh", 129.21],
    ["item", "Accise e IVA", null, 100],
    ["total", "Totale bolletta", null, 897.67],
  ]);
  const flow = (await import("node:fs")).readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /Scontrino della bolletta attuale/);
  assert.match(flow, /side: "current"/);
  console.log("BILL_SCONTRINO=PASS");
}

// Tony (1/11, "devi allineare le righe per leggere meglio il paragone"): bill and offer share one table, the same voce on the
// same row; a voce on one side only keeps its row with the other side empty.
{
  const quotas = [{ key: "CONSUMPTION", current: 797.67, offer: 788.68, currentSeller: 668.46, offerSeller: 659.47 }, { key: "FIXED", current: 17.31, offer: 18.81, currentSeller: 13.5, offerSeller: 15 }, { key: "POWER", current: 67.39, offer: 67.39, currentSeller: 0, offerSeller: 0 }, { key: "TAXES", current: 239.48, offer: 239, currentSeller: null, offerSeller: null }];
  const bill = offerScontrino({ quotas, offerTotal: 1121.85, taxesIncluded: true, vector: "EE", quantity: 2642, months: 1, powerKw: 15, side: "current", excluded: [{ label: "Altre partite", amount: 403.86 }] });
  const offer = offerScontrino({ quotas, offerTotal: 1110, taxesIncluded: true, vector: "EE", quantity: 2642, months: 1, powerKw: 15, discount: -5 });
  const rows = pairScontrini(bill, offer);
  const row = (label) => rows.find((item) => item.label === label);
  assert.deepEqual([row("2.642 kWh").bill.amount, row("2.642 kWh").offer.amount], [797.67, 793.68]);
  assert.equal(rows.filter((item) => item.label === "di cui spesa per la vendita di energia elettrica").every((item) => item.bill && item.offer), true, "each di cui on one row for both sides");
  assert.equal(row("Altre partite").offer, null);
  assert.equal(row("Sconto commerciale aziendale").bill, null);
  assert.deepEqual([row("Totale bolletta").bill.amount, row("Totale bolletta").offer.amount], [1525.71, 1110]);
  assert.equal(rows.filter((item) => item.kind === "total").length, 1);
  console.log("SCONTRINO_PAIR=PASS");
}
