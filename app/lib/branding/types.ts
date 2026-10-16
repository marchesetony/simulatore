export type BrandingLogoContentType = "image/png" | "image/jpeg" | "image/webp";

export interface TenantBrandingLogo {
  readonly contentType: BrandingLogoContentType;
  readonly dataBase64: string;
  readonly byteLength: number;
}

export interface TenantBranding {
  readonly legalName: string;
  readonly vatNumber: string | null;
  readonly address: string | null;
  readonly logo: TenantBrandingLogo | null;
}

export interface TenantBrandingView extends TenantBranding {
  readonly tenantId: string;
  readonly version: number | null;
  readonly updatedAt: string | null;
  readonly synthetic: boolean;
}

export interface TenantBrandingInput {
  readonly legalName?: unknown;
  readonly vatNumber?: unknown;
  readonly address?: unknown;
  readonly logo?: unknown;
  readonly expectedVersion?: unknown;
}
