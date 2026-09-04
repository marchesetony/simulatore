import type { RegulatoryCustomerScope, RegulatoryValueComponentCode } from "../foundation/regulatory-types.ts";

export interface RegulatoryRefreshDomain {
  readonly componentCode: RegulatoryValueComponentCode;
  readonly customerScope: RegulatoryCustomerScope;
  readonly normalizedUnit: "EUR/KWH" | "EUR/KW/YEAR" | "EUR/POD/YEAR";
  readonly sourceAdapter: "ARERA_ELECTRICITY";
}

export const REGULATORY_REFRESH_FREQUENCY = "DAILY" as const;
export const REGULATORY_REFRESH_CRON = "15 3 * * *" as const;
export const REGULATORY_REFRESH_STALE_DAYS = 35 as const;

const residentScope = "DOMESTIC_RESIDENT_BT" as const;
const bta6Scope = "NON_DOMESTIC_BT_BTA6" as const;

const residentDomains: readonly RegulatoryRefreshDomain[] = [
  { componentCode: "UC3", customerScope: residentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "UC6", customerScope: residentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "UC6", customerScope: residentScope, normalizedUnit: "EUR/KW/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "NETWORK_FIXED", customerScope: residentScope, normalizedUnit: "EUR/POD/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "NETWORK_POWER", customerScope: residentScope, normalizedUnit: "EUR/KW/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "TRANSMISSION_ENERGY", customerScope: residentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
];

const bta6Domains: readonly RegulatoryRefreshDomain[] = [
  { componentCode: "NETWORK_FIXED", customerScope: bta6Scope, normalizedUnit: "EUR/POD/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "NETWORK_POWER", customerScope: bta6Scope, normalizedUnit: "EUR/KW/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "NETWORK_ENERGY", customerScope: bta6Scope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "METERING_FIXED", customerScope: bta6Scope, normalizedUnit: "EUR/POD/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "TRANSMISSION_ENERGY", customerScope: bta6Scope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "UC3", customerScope: bta6Scope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "UC6", customerScope: bta6Scope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "UC6", customerScope: bta6Scope, normalizedUnit: "EUR/POD/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
];

/** Single source of truth shared by the economic calculator and refresh service. */
export const CALCULATED_REGULATORY_DOMAINS: readonly RegulatoryRefreshDomain[] = Object.freeze([...residentDomains, ...bta6Domains]);
export const AUTO_REFRESH_REGISTERED_DOMAINS = CALCULATED_REGULATORY_DOMAINS;

export function regulatoryDomainKey(domain: Pick<RegulatoryRefreshDomain, "componentCode" | "customerScope" | "normalizedUnit">): string {
  return `${domain.componentCode}|${domain.customerScope}|${domain.normalizedUnit}`;
}

const registeredKeys = new Set(CALCULATED_REGULATORY_DOMAINS.map(regulatoryDomainKey));

export function isCalculatedRegulatoryDomain(domain: Pick<RegulatoryRefreshDomain, "componentCode" | "customerScope" | "normalizedUnit">): boolean {
  return registeredKeys.has(regulatoryDomainKey(domain));
}

export function assertCalculatedRegulatoryDomain(domain: Pick<RegulatoryRefreshDomain, "componentCode" | "customerScope" | "normalizedUnit">): void {
  if (!isCalculatedRegulatoryDomain(domain)) throw new Error("REGULATORY_REFRESH_DOMAIN_UNREGISTERED");
}

export function assertAutoRefreshCoverage(domains: readonly RegulatoryRefreshDomain[] = CALCULATED_REGULATORY_DOMAINS): void {
  const registered = new Set(AUTO_REFRESH_REGISTERED_DOMAINS.map(regulatoryDomainKey));
  for (const domain of domains) if (!registered.has(regulatoryDomainKey(domain))) throw new Error(`REGULATORY_REFRESH_DOMAIN_UNREGISTERED:${regulatoryDomainKey(domain)}`);
}
