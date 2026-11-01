import assert from "node:assert/strict";
import { getConfiguredCteOcrProvider } from "../app/lib/cte/ingestion.ts";
import { ANTHROPIC_TOOL_NAME } from "../app/lib/cte/anthropic.ts";

// Tony (1/11, "come si può velocizzare l'analisi? e le risposte? e tutte le operazioni?"): the PDF sent to the reader
// carries a prompt-cache breakpoint, so a second reading of the same document (the verifier) reuses tools, instructions
// and document from the cache instead of reading the whole PDF again.
const env = { CTE_OCR_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "unit-test-key-only", ANTHROPIC_MODEL: "unit-test-model", ANTHROPIC_BASE_URL: "https://api.anthropic.com" };
const field = (path, value) => ({ path, value, confidence: 0.9, sourcePage: 1, sourceText: `evidence:${path}`, status: "CONFIRMED" });
const input = { schemaVersion: 1, documentType: "CTE", vector: "EE", fields: [field("supplier.name", "Synthetic supplier")], extractionNotes: [] };
const bodies = [];
const fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return Response.json({ stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", name: ANTHROPIC_TOOL_NAME, input }] }); };
const provider = getConfiguredCteOcrProvider(env, fetch);
await provider.extract({ bytes: new Uint8Array(Buffer.from("%PDF-1.7 synthetic")), contentType: "application/pdf", fileName: "synthetic.pdf" });
assert.ok(bodies.length >= 1);
for (const body of bodies) {
  assert.equal(body.messages[0].content[0].type, "document");
  assert.deepEqual(body.messages[0].content[0].cache_control, { type: "ephemeral" });
}
console.log("reading-speed-cache ok");
