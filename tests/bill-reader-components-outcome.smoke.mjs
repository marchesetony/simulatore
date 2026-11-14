import assert from "node:assert/strict";
import { ClaudeBillReader, parseBillReading, BILL_READER_PROMPT } from "../app/lib/reading/bill-reader.ts";
import { toStructuredBill } from "../app/lib/reading/bill-reader-map.ts";
import { BILL_READER_TOOL_NAME } from "../app/lib/reading/bill-reader-schema.ts";
import { checkBillReading, printedComponentOutcomeChecks } from "../app/lib/reading/bill-reader-checks.ts";
import { readingRulesGuidance } from "../app/lib/reading/rules.ts";

// Tony (13/11/2026, "CORREZIONE MIRATA LETTORE AI", BPower 071808E): the reread summary bill still showed oneri, accise and IVA
// as "Non letto separatamente" although they are printed on pages 5 and 4. The search for the components printed apart is
// now mandatory on every page; every category needs the printed amount or a declared absence; an omitted field, a dropped row
// and a category without outcome are reported and send the bill to the existing second reading, once. Nothing is calculated.
// Synthetic data with the amounts of the control case; no real customer, POD or document.

const sc = (etichetta, tipo, quota, importo, extra = {}) => ({ etichetta, tipo, quota, quantita: "", unita: "", prezzoMedio: "", unitaPrezzo: "", importo, pagina: 2, ...extra });
const component = (etichetta, categoria, importo, pagina, sezione = "") => ({ etichetta, categoria, importo, sezione, pagina });
const absent = (categoria, motivo) => ({ campo: `componentiStampate.${categoria}`, motivo });
const base = {
  tipoDocumento: "BOLLETTA_SINTETICA", vettore: "EE", tipoCliente: "ALTRI_USI", livelloTensione: "BT",
  fornitore: "VENDITORE DI PROVA S.P.A.", intestatario: "CLIENTE DI PROVA", pod: "IT000E00000002", periodoDal: "2026-10-01", periodoAl: "2026-10-31",
  consumoFatturato: "10", consumoF1: "3", consumoF2: "4", consumoF3: "3", totaleBolletta: "35,00",
  scontrino: [
    sc("Quota per consumi", "QUOTA_TOTALE", "CONSUMI", "3,42", { quantita: "10", unita: "kWh", prezzoMedio: "0,342", unitaPrezzo: "€/kWh" }),
    sc("di cui spesa per la vendita di energia elettrica", "DI_CUI_VENDITA", "CONSUMI", "2,92"),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "CONSUMI", "0,50"),
    sc("Quota fissa", "QUOTA_TOTALE", "FISSA", "18,74"),
    sc("di cui spesa per la vendita di energia elettrica", "DI_CUI_VENDITA", "FISSA", "15,00"),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "FISSA", "3,74"),
    sc("Quota potenza", "QUOTA_TOTALE", "POTENZA", "6,40"),
    sc("di cui spesa per la rete e gli oneri generali di sistema", "DI_CUI_RETE_ONERI", "POTENZA", "6,40"),
    sc("Accise e IVA", "ACCISE_IVA", "NESSUNA", "6,44"),
    sc("Totale bolletta", "TOTALE_BOLLETTA", "NESSUNA", "35,00"),
  ],
  dettaglio: [],
};
// The control case: oneri on page 5, accise and IVA on page 4, transport not printed apart (declared, never calculated).
const control = {
  ...base,
  componentiStampate: [component("Oneri generali di sistema", "ONERI_SISTEMA", "3,95", 5, "Oneri di sistema"), component("Accise", "ACCISE", "0,13", 4, "Riepilogo imposte"), component("IVA 10%", "IVA", "6,31", 4, "Riepilogo IVA")],
  assenti: [{ campo: "dettaglio", motivo: "bolletta sintetica" }, absent("TRASPORTO_RETE", "il trasporto non è stampato a parte: solo 'rete e oneri' nello scontrino")],
};
const codes = (reading) => checkBillReading(parseBillReading(reading)).map((check) => check.code);

// 1. The instructions: a reading step of its own, informative sections, VAT summary, ASOS/ARIM, an outcome per category.
assert.match(BILL_READER_PROMPT, /7\) le componenti stampate \(componentiStampate\)/);
assert.match(BILL_READER_PROMPT, /riepilogo IVA \(imponibile, aliquota, imposta\)/);
assert.match(BILL_READER_PROMPT, /ASOS, ARIM\), anche quando non ci sono elementi di dettaglio quantità × prezzo/);
assert.match(BILL_READER_PROMPT, /l'esito è obbligatorio/);
assert.match(BILL_READER_PROMPT, /Non calcolarlo, non ricavarlo per differenza/);
assert.match(readingRulesGuidance("BILL"), /4\) sempre, in tutte le pagine, le componenti stampate a parte/);
assert.match(readingRulesGuidance("BILL"), /sezioni informative, gli oneri generali di sistema \(ASOS, ARIM\), le accise e l'IVA/);

// 2. Components on the informative pages, transport declared absent: a complete reading, nothing calculated.
assert.deepEqual(codes(control), [], "the control case is complete and adds up");
const bill = toStructuredBill({ reading: parseBillReading(control), checks: [], reread: false });
assert.deepEqual(bill.printedComponents.map((item) => [item.category, item.rawAmount, item.page]), [["SYSTEM_CHARGES", "3,95", 5], ["EXCISE", "0,13", 4], ["VAT", "6,31", 4]]);
assert.equal(bill.printedComponents.some((item) => item.category === "NETWORK"), false, "6,69 is never attributed to the reading");
assert.ok(bill.readingAbsent.some((item) => item.field === "componentiStampate.TRASPORTO_RETE"));
assert.equal(bill.economicChargeLines.some((line) => ["ASOS", "ARIM", "EXCISE", "VAT"].includes(line.code)), false, "the engine rows stay as they were: no double count");

// 3. A category really absent: declared, so no check.
assert.deepEqual(codes({ ...control, componentiStampate: control.componentiStampate.filter((row) => row.categoria !== "ACCISE"), assenti: [...control.assenti, absent("ACCISE", "non stampate a parte")] }), []);

// 4. A category omitted by the model (neither amount nor absence): reported.
const omittedVat = parseBillReading({ ...control, componentiStampate: control.componentiStampate.filter((row) => row.categoria !== "IVA") });
assert.deepEqual(printedComponentOutcomeChecks(omittedVat).map((check) => check.code), ["COMPONENTS_UNANSWERED"]);
assert.match(printedComponentOutcomeChecks(omittedVat)[0].message, /senza esito: IVA\./);
// The whole field not returned: told apart from an empty list.
const { componentiStampate: _unused, ...withoutField } = control; void _unused;
assert.deepEqual(codes(withoutField), ["COMPONENTS_FIELD_MISSING"]);
assert.ok(parseBillReading(withoutField).campiOmessi.includes("componentiStampate"));
assert.equal(parseBillReading(control).campiOmessi?.includes("componentiStampate") ?? false, false);
assert.deepEqual(codes({ ...control, componentiStampate: [], assenti: [] }), ["COMPONENTS_UNANSWERED"], "an empty list without absences is incomplete");

// 5. A category not recognised (or an unreadable amount): dropped from the data, reported in the checks.
const odd = { ...control, componentiStampate: [...control.componentiStampate, component("Imposta di bollo", "BOLLO", "2,00", 4), component("IVA", "IVA", "n.d.", 4)] };
assert.deepEqual(codes(odd), ["COMPONENTS_DISCARDED"]);
assert.match(checkBillReading(parseBillReading(odd))[0].message, /"Imposta di bollo" \(categoria BOLLO, importo 2,00\); "IVA" \(categoria IVA, importo n\.d\.\)/);
assert.equal(toStructuredBill({ reading: parseBillReading(odd), checks: [], reread: false }).printedComponents.length, 3, "only valid rows are kept");

// 6. Amounts that do not match the printed totals: reported, never corrected.
assert.deepEqual(codes({ ...control, componentiStampate: control.componentiStampate.map((row) => row.categoria === "IVA" ? { ...row, importo: "6,41" } : row) }), ["COMPONENTS_TAXES"]);
assert.deepEqual(codes({ ...control, componentiStampate: control.componentiStampate.map((row) => row.categoria === "ONERI_SISTEMA" ? { ...row, importo: "10,95" } : row) }), ["COMPONENTS_NETWORK_SYSTEM"]);

// 7. A detailed bill: ASOS/ARIM, accise and IVA in the detail and also as components; the detail rows are unchanged.
const detailed = { ...control, tipoDocumento: "BOLLETTA_COMPLETA", dettaglio: [
  { descrizione: "Oneri ASOS", voce: "ONERI_ASOS", fascia: "NESSUNA", periodo: "", quantita: "10", unita: "kWh", prezzo: "0,295", unitaPrezzo: "€/kWh", importo: "2,95", pagina: 5 },
  { descrizione: "Oneri ARIM", voce: "ONERI_ARIM", fascia: "NESSUNA", periodo: "", quantita: "10", unita: "kWh", prezzo: "0,100", unitaPrezzo: "€/kWh", importo: "1,00", pagina: 5 },
] };
assert.deepEqual(codes(detailed), []);
const detailedBill = toStructuredBill({ reading: parseBillReading(detailed), checks: [], reread: false });
assert.deepEqual(detailedBill.economicChargeLines.filter((line) => ["ASOS", "ARIM"].includes(line.code)).map((line) => line.amount), ["2,95", "1,00"]);

// 8. The existing second reading, once: an incomplete first reading is read again with the finding; never more than twice.
const message = (input) => ({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", stop_sequence: null, usage: {}, content: [{ type: "tool_use", id: "t", name: BILL_READER_TOOL_NAME, input }] });
const reader = (answers, calls) => new ClaudeBillReader({ messages: { async create(params) { calls.push(params); return message(answers[Math.min(calls.length - 1, answers.length - 1)]); } } }, "claude-sonnet-4-5", 8000);
let calls = [];
const fixed = await reader([withoutField, control], calls).extract({ bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf" });
assert.equal(calls.length, 2, "read again because the components were not returned");
assert.match(calls[1].messages[0].content[1].text, /Componenti stampate non restituite/);
assert.deepEqual([fixed.readingReread, fixed.readingChecks, fixed.printedComponents.length], [true, [], 3]);
calls = [];
const stubborn = await reader([withoutField], calls).extract({ bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf" });
assert.equal(calls.length, 2, "no endless rereading");
assert.deepEqual(stubborn.printedComponents, [], "nothing is filled in");
assert.match(stubborn.readingChecks.join(" "), /Componenti stampate non restituite/, "the incomplete reading stays visible to the operator");
calls = [];
await reader([control], calls).extract({ bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf" });
assert.equal(calls.length, 1, "a complete reading is read once");
console.log("bill-reader-components-outcome OK");
