import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ingestBill, LocalBillRepository, LocalDocumentStorage, toPublicDocument } from "../app/lib/foundation/real-bill.ts";

const source = await readFile(new URL("../app/api/bills/route.ts", import.meta.url), "utf8");
const original = { ...process.env };
const root = await mkdtemp(path.join(os.tmpdir(), "phase7-bills-route-"));
const text = "Supplier: Aurora; POD: IT001; Customer: Cliente Demo; Periodo: Jan 2027; Consumo annuo: 100; Consumo fatturato: 10; Totale da pagare: 20";
const audit = { async record() {} };
async function seed(tenant) { return ingestBill({ tenantId: tenant, fileName: `${tenant}.pdf`, contentType: "application/pdf", bytes: new Uint8Array(Buffer.from("%PDF-1.7 fake")), maxBytes: 10_000_000, storage: new LocalDocumentStorage(root), extractor: { async extract() { return { text, pages: 1 }; } }, repository: new LocalBillRepository(root), audit }); }

try {
  const own = await seed("tenant_alpha"); await seed("tenant_other");
  const listed = (await new LocalBillRepository(root).list("tenant_alpha")).map(toPublicDocument);
  assert.equal(listed.length, 1); assert.equal(listed[0].id, own.id); assert.equal("objectKey" in listed[0], false); assert.equal("path" in listed[0], false); assert.equal("rawDocument" in listed[0], false); assert.equal("ocr" in listed[0], false);
  assert.deepEqual((await new LocalBillRepository(root).list("tenant_empty")).map(toPublicDocument), []);
  assert.match(source, /export async function GET\(request: Request\)/); assert.match(source, /requestPrincipal\(request, "READ"\)/); assert.match(source, /billRepository\.list\(principal\.tenantId\)/); assert.match(source, /cache-control.*no-store/); assert.match(source, /export async function POST\(request: Request\)/); assert.match(source, /request\.formData\(\)/); assert.doesNotMatch(source, /tenantId.*searchParams|x-foundation-tenant-id/); assert.match(source, /AUTH_CONFIGURATION_INVALID/); assert.match(source, /BILL_LIST_TOO_LARGE/);
  assert.match(source, /INTERNAL_TO_PUBLIC_CODE/); assert.match(source, /function boundedPublicCode\(internalCode: unknown, fallback: string\)/); assert.match(source, /BILL_OPERATION_FAILED/); assert.match(source, /function publicStatus\(code: string\)/);
  assert.match(source, /boundedPublicCode\(result\.errorCode, "BILL_OPERATION_FAILED"\)/); assert.match(source, /structuredProviderFactory/); assert.match(source, /createAnthropicBillSdkAdapter/); assert.doesNotMatch(source, /createAnthropicStructuredBillProvider/); assert.doesNotMatch(source, /ocrProviderFactory/); assert.doesNotMatch(source, /catch \{ extractionProvider = undefined; \}/); assert.doesNotMatch(source, /return deny\(result\.errorCode/); assert.doesNotMatch(source, /const code = error instanceof Error \? error\.message/); assert.doesNotMatch(source, /code = error\.message/); assert.doesNotMatch(source, /return error\.message/); assert.doesNotMatch(source, /Bearer\s+|document\.cookie|stackTrace|objectKey|rawDocument/);
  assert.match(source, /"cache-control": "no-store, private"/); assert.match(source, /"vary": "Cookie, Authorization"/); assert.match(source, /status: 201, headers: noStoreHeaders/); assert.match(source, /status, headers: noStoreHeaders/);
  for (const dangerous of ["C:\\\\secret\\\\bill.pdf", "/srv/secrets/bill.pdf", "Bearer secret-token", "session=secret-cookie", "Error: stack trace"]) assert.equal(source.includes(dangerous), false, `unsafe public error fixture: ${dangerous}`);
  const detail = await readFile(new URL("../app/api/bills/[id]/route.ts", import.meta.url), "utf8"); assert.match(detail, /NO_STORE_HEADERS/); assert.match(detail, /INTERNAL_TO_PUBLIC_CODE/); assert.doesNotMatch(detail, /const code = error instanceof Error \? error\.message/); assert.doesNotMatch(detail, /return error\.message/); assert.match(detail, /BILL_OPERATION_FAILED/); assert.match(detail, /vary.*Cookie, Authorization/);
  console.log("bills-route smoke: ok (repository + static server-contract; no live HTTP handler execution)");
} finally { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; for (const [key, value] of Object.entries(original)) process.env[key] = value; await rm(root, { recursive: true, force: true }); }
