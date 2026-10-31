/**
 * Tony (31/10): "l'offerta deve essere formulata come una bolletta come lo scontrino elettrico, con logo dell'azienda dati
 * aziendali ...". The company that bought the app prints its own name, data and logo on every proposal.
 */
export interface CompanyProfile {
  readonly name: string;
  readonly address: string;
  readonly vatNumber: string;
  readonly phone: string;
  readonly email: string;
  readonly website: string;
  /** JPEG logo as a data URL (the browser converts any picture to JPEG before saving). */
  readonly logo: string | null;
  readonly updatedAt: string;
}

export const COMPANY_PROFILE_RECORD_ID = "profile";
export const COMPANY_LOGO_MAX_BYTES = 400_000;
const TEXT_LIMITS: Readonly<Record<Exclude<keyof CompanyProfile, "logo" | "updatedAt">, number>> = { name: 120, address: 200, vatNumber: 40, phone: 40, email: 120, website: 120 };

export function emptyCompanyProfile(): CompanyProfile {
  return { name: "", address: "", vatNumber: "", phone: "", email: "", website: "", logo: null, updatedAt: "" };
}

export function parseCompanyProfile(value: unknown, now: string): CompanyProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("COMPANY_PROFILE_INVALID");
  const input = value as Record<string, unknown>;
  const text = (key: keyof typeof TEXT_LIMITS) => {
    const raw = input[key] ?? "";
    if (typeof raw !== "string") throw new Error("COMPANY_PROFILE_INVALID");
    const clean = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (clean.length > TEXT_LIMITS[key]) throw new Error("COMPANY_PROFILE_TOO_LONG");
    return clean;
  };
  const logo = input.logo ?? null;
  if (logo !== null) {
    if (typeof logo !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new Error("COMPANY_LOGO_INVALID");
    const bytes = Buffer.from(logo.slice(logo.indexOf(",") + 1), "base64");
    if (bytes.length > COMPANY_LOGO_MAX_BYTES) throw new Error("COMPANY_LOGO_TOO_LARGE");
    if (!jpegSize(bytes)) throw new Error("COMPANY_LOGO_INVALID");
  }
  return { name: text("name"), address: text("address"), vatNumber: text("vatNumber"), phone: text("phone"), email: text("email"), website: text("website"), logo: logo as string | null, updatedAt: now };
}

/** Width and height of a baseline or progressive JPEG, read from its SOF marker; null when the bytes are not a JPEG. */
export function jpegSize(bytes: Uint8Array): { readonly width: number; readonly height: number; readonly components: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[offset + 5] << 8) + bytes[offset + 6], width: (bytes[offset + 7] << 8) + bytes[offset + 8], components: bytes[offset + 9] };
    }
    offset += 2 + length;
  }
  return null;
}
