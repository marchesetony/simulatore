import assert from "node:assert/strict";
import { BILL_ANALYST_TOOL_NAME, BILL_CORE_TOOL_NAME } from "../app/lib/ingestion/bill-two-stage.ts";
import { AnthropicTwoStageBillSdkAdapter, SCONTRINO_TRANSCRIPT_TOOL_NAME, scontrinoTranscriptOf } from "../app/lib/ingestion/anthropic-bill-sdk.ts";
import { BILL_WIRE_FIELD_NAMES } from "../app/lib/ingestion/bill-wire.ts";
import { scontrinoSource, withScontrinoTranscript } from "../app/lib/ingestion/printed-scontrino.ts";
import { withDocumentPriceRows } from "../app/lib/market/pun-reference.ts";

// Tony (1/11, "bisogna che anche quella letta da immagine possa essere letta allo stesso modo del pdf"): a bill with no text
// layer (photo or scan) gets its scontrino copied row by row by the model, and the copy goes through the same parser as the
// PDF text. Synthetic rows shaped like the Loomen PMI scontrino; no customer data.
const rows = ["Quota per consumi", "2.642 kWh x 0,301919 €/kWh", "+ 797,67 €", "di cui spesa per la vendita di energia elettrica", "0,253013 €/kWh", "+ 668,46 €",
  "di cui spesa per la rete e gli oneri generali di sistema", "0,048906 €/kWh", "+ 129,21 €", "Quota fissa", "1 mese", "17,310000 €/mese", "+ 17,31 €",
  "di cui spesa per la vendita di energia elettrica", "13,500000 €/mese", "+ 13,50 €", "di cui spesa per la rete e gli oneri generali di sistema", "3,810000 €/mese", "+ 3,81 €",
  "Altre partite - Interessi, Bollo", "+ 403,86 €", "Accise e IVA", "+ 239,48 €", "Totale bolletta", "= 1.442,32 €"];
const tool = (name, input) => ({ type: "tool_use", id: `${name}-fixture`, name, input });
const message = (content) => ({ type: "message", role: "assistant", content, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } });
const found = (value) => ({ value: String(value), status: "FOUND" });
const missing = () => ({ value: "NOT_FOUND", status: "NOT_FOUND" });
const coreWire = () => { const wire = { schemaVersion: 1 }; for (const name of BILL_WIRE_FIELD_NAMES) wire[name] = name === "vector" ? found("EE") : name === "customerType" ? found("NON_RESIDENTIAL") : name === "voltageLevel" ? found("LV") : name === "billingPeriod" ? found("01/07/2026 - 31/07/2026") : name === "pod" ? found("IT001E12345678") : name === "totalAmount" ? found("1442,32") : ["annualConsumption", "billedConsumption", "powerKw", "f1Consumption", "f2Consumption", "f3Consumption"].includes(name) ? found("80") : missing(); delete wire.customerId; return wire; };
// The AI analyst read the quota totals as charges (the Loomen error): the transcript replaces them.
const analyst = { schemaVersion: "1", items: [{ kind: "CHARGE", code: "OTHER_CHARGE", label: "Quota per consumi", value: "", unit: "kWh", quantity: "2642", unitPrice: "", amount: "797,67", period: "", status: "FOUND" }] };

const sent = [];
const client = { messages: { async create(params) {
  sent.push(params);
  const name = params.tools[0].name;
  if (name === BILL_CORE_TOOL_NAME) return message([tool(name, coreWire())]);
  if (name === SCONTRINO_TRANSCRIPT_TOOL_NAME) return message([tool(name, { rows })]);
  return message([tool(BILL_ANALYST_TOOL_NAME, analyst)]);
} } };
const image = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: "image/jpeg" };
const reading = await new AnthropicTwoStageBillSdkAdapter(client, "synthetic-model", 8192).extract(image);
const transcriptRequest = sent.find((params) => params.tools[0].name === SCONTRINO_TRANSCRIPT_TOOL_NAME);
assert.ok(transcriptRequest, "an image bill gets its scontrino transcribed");
assert.equal(transcriptRequest.tool_choice?.name, SCONTRINO_TRANSCRIPT_TOOL_NAME);
assert.equal(reading.scontrinoTranscript, rows.join("\n"), "the transcript is kept with the reading");
const amounts = reading.economicChargeLines.map((line) => [line.code, line.amount]);
assert.deepEqual(amounts.filter(([code]) => code !== "OTHER_CHARGE" && code !== "NETWORK_SYSTEM"), [["ALTRE_PARTITE", "403,86 €"], ["TAX_SUBTOTAL", "239,48 €"], ["BILL_TOTAL", "1.442,32 €"]]);
assert.equal(reading.economicChargeLines.filter((line) => line.description === "Quota per consumi").length, 1, "the AI's quota total is replaced, not doubled");

// A PDF with a text layer is never transcribed: the text is read directly.
assert.equal(scontrinoSource({ scontrinoTranscript: "old" }, "Quota per consumi\ndi cui spesa per la vendita 0,10 €/kWh 10,00 €"), "Quota per consumi\ndi cui spesa per la vendita 0,10 €/kWh 10,00 €");
assert.equal(scontrinoSource({ scontrinoTranscript: "copia" }, null), "copia");
// A transcript the parser cannot read is not kept; nothing is invented.
const plain = { economicChargeLines: [] };
assert.equal(withScontrinoTranscript(plain, "Bolletta senza scontrino"), plain);
assert.equal(scontrinoTranscriptOf(message([tool(SCONTRINO_TRANSCRIPT_TOOL_NAME, { rows: [] })])), null);

// An archived image bill shows the same scontrino on every load, with no storage read.
const shown = await withDocumentPriceRows({ fileName: "bolletta.jpg", resolvedVector: "EE", structuredBill: { ...reading, economicChargeLines: [] } }, async () => { throw new Error("no read for images"); });
assert.equal(shown.structuredBill.economicChargeLines.length, reading.economicChargeLines.length);
console.log("BILL_SCONTRINO_TRANSCRIPT=PASS");
