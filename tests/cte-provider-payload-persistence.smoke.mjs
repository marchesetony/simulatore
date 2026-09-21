import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { persistCteProviderPayload } from "../app/lib/cte/provider-diagnostics.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "cte-provider-diagnostics-"));
const files = await persistCteProviderPayload({
  tenantId: "tenant_real-test",
  documentId: "cte-real-document",
  attemptNumber: 1,
  rootDir: root,
  capture: {
    requestId: "req-real-test",
    provider: "anthropic",
    model: "real-model",
    timestamp: "2026-09-17T00:00:00.000Z",
    responseStatus: 200,
    rawPayload: { content: [{ type: "tool_use", input: { fields: [] } }], headers: { authorization: "Bearer secret", token: "secret" } },
    normalizedPayload: { schemaVersion: 1, documentType: "CTE", vector: "EE" },
    schemaValidation: { status: "FAIL", errorCode: "CTE_EXTRACTION_SCHEMA_INVALID", issuePaths: ["fields[16].value"], issueCodes: ["TYPE"] },
  },
});

assert.equal(await readFile(files.rawPayloadFile, "utf8").then((value) => value.includes("Bearer secret")), false);
assert.equal(await readFile(files.rawPayloadFile, "utf8").then((value) => value.includes('"rawProviderPayload"')), true);
assert.equal(await readFile(files.normalizedPayloadFile, "utf8").then((value) => value.includes('"normalizedProviderPayload"')), true);
assert.equal(await readFile(files.validationFile, "utf8").then((value) => value.includes('"fields[16].value"')), true);
assert.match(files.rawPayloadFile, /tenant_real-test/);

console.log("cte provider payload persistence smoke: ok (tenant-scoped raw/normalized/validation files and secret redaction)");
