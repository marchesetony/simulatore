import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LocalFilesystemAdapter } from "../app/lib/persistence/local.ts";
import { BRANDING_LOGO_MAX_BYTES, SYNTHETIC_TENANT_BRANDING, readTenantBranding, saveTenantBranding, validateTenantBranding } from "../app/lib/branding/service.ts";

const tenant = "tenant_branding-smoke";
const otherTenant = "tenant_branding-other";
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]).toString("base64");
const input = { legalName: "  Energia   Prova S.p.A. ", vatNumber: "IT 09876543210", address: "Corso Inventato 1, 10100 Torino (TO)", logo: { contentType: "image/png", dataBase64: png } };

const root = await mkdtemp(path.join(os.tmpdir(), "tenant-branding-"));
try {
  const repository = new LocalFilesystemAdapter(root).collection("tenant-branding");

  // Local synthetic mode shows invented company data until the tenant saves its own.
  const synthetic = await readTenantBranding(repository, tenant, true);
  assert.equal(synthetic.synthetic, true);
  assert.equal(synthetic.legalName, SYNTHETIC_TENANT_BRANDING.legalName);
  assert.equal(synthetic.version, null);
  assert.equal(await readTenantBranding(repository, tenant, false), null);

  // Normalization and validation.
  const normalized = validateTenantBranding(input);
  assert.equal(normalized.legalName, "Energia Prova S.p.A.");
  assert.equal(normalized.vatNumber, "IT09876543210");
  assert.equal(normalized.logo.byteLength, 32);
  assert.equal(validateTenantBranding({ legalName: "Solo Nome" }).logo, null);
  assert.throws(() => validateTenantBranding({ ...input, legalName: " " }), /BRANDING_LEGAL_NAME_REQUIRED/);
  assert.throws(() => validateTenantBranding({ ...input, legalName: "<script>" }), /BRANDING_LEGAL_NAME_INVALID/);
  assert.throws(() => validateTenantBranding({ ...input, vatNumber: "123" }), /BRANDING_VAT_INVALID/);
  assert.throws(() => validateTenantBranding({ ...input, logo: { contentType: "image/svg+xml", dataBase64: png } }), /BRANDING_LOGO_TYPE_INVALID/);
  assert.throws(() => validateTenantBranding({ ...input, logo: { contentType: "image/jpeg", dataBase64: png } }), /BRANDING_LOGO_SIGNATURE_INVALID/);
  assert.throws(() => validateTenantBranding({ ...input, logo: { contentType: "image/png", dataBase64: "not base64!" } }), /BRANDING_LOGO_INVALID/);
  const oversized = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(BRANDING_LOGO_MAX_BYTES)]).toString("base64");
  assert.throws(() => validateTenantBranding({ ...input, logo: { contentType: "image/png", dataBase64: oversized } }), /BRANDING_LOGO_TOO_LARGE/);

  // Save, version, optimistic concurrency.
  const saved = await saveTenantBranding(repository, tenant, input, "2026-10-16T10:00:00.000Z");
  assert.equal(saved.synthetic, false);
  assert.equal(saved.version, 1);
  await assert.rejects(() => saveTenantBranding(repository, tenant, input), /BRANDING_VERSION_REQUIRED/);
  await assert.rejects(() => saveTenantBranding(repository, tenant, { ...input, expectedVersion: 7 }), /BRANDING_VERSION_CONFLICT/);
  const updated = await saveTenantBranding(repository, tenant, { ...input, logo: null, expectedVersion: 1 });
  assert.equal(updated.version, 2);
  assert.equal(updated.logo, null);
  const read = await readTenantBranding(repository, tenant, true);
  assert.equal(read.legalName, "Energia Prova S.p.A.");
  assert.equal(read.synthetic, false);

  // Tenant isolation: another tenant never sees this branding.
  const other = await readTenantBranding(repository, otherTenant, true);
  assert.equal(other.synthetic, true);
  assert.equal(other.legalName, SYNTHETIC_TENANT_BRANDING.legalName);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("tenant-branding smoke passed");
