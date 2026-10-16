import type { TenantRecordRepository } from "../persistence/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deterministicRecordId } from "../persistence/types.ts";
import type { BrandingLogoContentType, TenantBranding, TenantBrandingInput, TenantBrandingLogo, TenantBrandingView } from "./types";

export type TenantBrandingRepository = TenantRecordRepository<TenantBranding>;

export const BRANDING_LOGO_MAX_BYTES = 262144;
export const BRANDING_CORRELATION_ID = "tenant-branding-v1";

/** Invented company data shown in local synthetic mode until the tenant saves its own branding. */
export const SYNTHETIC_TENANT_BRANDING: TenantBranding = Object.freeze({
  legalName: "Lumenica Energia Demo S.r.l.",
  vatNumber: "IT01234567890",
  address: "Via delle Energie 12, 20100 Milano (MI)",
  logo: null,
});

const tenantPattern = /^tenant_[a-z0-9-]+$/;
const contentTypes: readonly BrandingLogoContentType[] = ["image/png", "image/jpeg", "image/webp"];

function fail(code: string): never { throw new Error(code); }
function assertTenant(tenantId: string): void { if (!tenantPattern.test(tenantId)) fail("BRANDING_TENANT_INVALID"); }
export function brandingRecordId(tenantId: string): string { assertTenant(tenantId); return deterministicRecordId("tenant-branding", tenantId, "current"); }

function cleanText(value: unknown, code: string, max: number): string {
  if (typeof value !== "string") return fail(code);
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > max || /[\u0000-\u001f\u007f<>]/.test(text)) return fail(code);
  return text;
}
function optionalText(value: unknown, code: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  const text = cleanText(value, code, max);
  return text.length ? text : null;
}

function legalName(value: unknown): string {
  const text = cleanText(value, "BRANDING_LEGAL_NAME_INVALID", 160);
  if (text.length < 2) fail("BRANDING_LEGAL_NAME_REQUIRED");
  return text;
}

function vatNumber(value: unknown): string | null {
  const text = optionalText(value, "BRANDING_VAT_INVALID", 20);
  if (text === null) return null;
  const compact = text.replace(/\s/g, "").toUpperCase();
  const digits = compact.startsWith("IT") ? compact.slice(2) : compact;
  if (!/^\d{11}$/.test(digits)) fail("BRANDING_VAT_INVALID");
  return `IT${digits}`;
}

function signatureMatches(bytes: Buffer, contentType: BrandingLogoContentType): boolean {
  if (contentType === "image/png") return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function logo(value: unknown): TenantBrandingLogo | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return fail("BRANDING_LOGO_INVALID");
  const item = value as Record<string, unknown>;
  const contentType = item.contentType as BrandingLogoContentType;
  if (!contentTypes.includes(contentType)) fail("BRANDING_LOGO_TYPE_INVALID");
  if (typeof item.dataBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.dataBase64) || item.dataBase64.length % 4 !== 0) fail("BRANDING_LOGO_INVALID");
  if (item.dataBase64.length > Math.ceil(BRANDING_LOGO_MAX_BYTES / 3) * 4) fail("BRANDING_LOGO_TOO_LARGE");
  const bytes = Buffer.from(item.dataBase64, "base64");
  if (bytes.length > BRANDING_LOGO_MAX_BYTES) fail("BRANDING_LOGO_TOO_LARGE");
  if (!signatureMatches(bytes, contentType)) fail("BRANDING_LOGO_SIGNATURE_INVALID");
  return { contentType, dataBase64: bytes.toString("base64"), byteLength: bytes.length };
}

export function validateTenantBranding(input: TenantBrandingInput): TenantBranding {
  if (typeof input !== "object" || input === null || Array.isArray(input)) fail("BRANDING_INPUT_INVALID");
  return { legalName: legalName(input.legalName), vatNumber: vatNumber(input.vatNumber), address: optionalText(input.address, "BRANDING_ADDRESS_INVALID", 200), logo: logo(input.logo) };
}

export async function readTenantBranding(repository: TenantBrandingRepository, tenantId: string, allowSynthetic: boolean): Promise<TenantBrandingView | null> {
  const record = await repository.get(tenantId, brandingRecordId(tenantId));
  if (record) return { ...validateTenantBranding(record.payload as TenantBrandingInput), tenantId, version: record.version, updatedAt: record.updatedAt, synthetic: false };
  return allowSynthetic ? { ...SYNTHETIC_TENANT_BRANDING, tenantId, version: null, updatedAt: null, synthetic: true } : null;
}

export async function saveTenantBranding(repository: TenantBrandingRepository, tenantId: string, input: TenantBrandingInput, now?: string): Promise<TenantBrandingView> {
  const branding = validateTenantBranding(input);
  const recordId = brandingRecordId(tenantId);
  const existing = await repository.get(tenantId, recordId);
  let expectedVersion: number | undefined;
  if (input.expectedVersion === undefined || input.expectedVersion === null) {
    if (existing) fail("BRANDING_VERSION_REQUIRED");
  } else {
    if (typeof input.expectedVersion !== "number" || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) fail("BRANDING_VERSION_INVALID");
    expectedVersion = input.expectedVersion;
  }
  try {
    const record = await repository.put({ tenantId, recordId, payload: branding, expectedVersion, now });
    return { ...branding, tenantId, version: record.version, updatedAt: record.updatedAt, synthetic: false };
  } catch (error) {
    if (error instanceof Error && error.message === "PERSISTENCE_VERSION_CONFLICT") fail("BRANDING_VERSION_CONFLICT");
    throw error;
  }
}

export function brandingLogoDataUri(branding: Pick<TenantBranding, "logo"> | null): string | null {
  return branding?.logo ? `data:${branding.logo.contentType};base64,${branding.logo.dataBase64}` : null;
}
