import type { RegulatoryCustomerScope, RegulatoryValueComponentCode, RegulatoryVariant } from "../foundation/regulatory-types.ts";

export interface RegulatoryRefreshDomain {
  readonly componentCode: RegulatoryValueComponentCode;
  readonly customerScope: RegulatoryCustomerScope;
  readonly normalizedUnit: "EUR/KWH" | "EUR/KW/YEAR" | "EUR/POD/YEAR";
  readonly regulatoryVariant?: RegulatoryVariant;
  readonly sourceAdapter: "ARERA_ELECTRICITY";
}

export const REGULATORY_REFRESH_FREQUENCY = "DAILY" as const;
export const REGULATORY_REFRESH_CRON = "15 3 * * *" as const;
export const REGULATORY_REFRESH_STALE_DAYS = 35 as const;

const residentScope = "DOMESTIC_RESIDENT_BT" as const;
const bta6Scope = "NON_DOMESTIC_BT_BTA6" as const;
const asosVariants = ["ASOS_CLASS_0", "ASOS_CLASS_1", "ASOS_CLASS_2", "ASOS_CLASS_3"] as const;

const residentDomains: readonly RegulatoryRefreshDomain[] = [
  { componentCode: "DISPATCHING_TOTAL", customerScope: residentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "ASOS", customerScope: residentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "ARIM", customerScope: residentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
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
  { componentCode: "ARIM", customerScope: bta6Scope, normalizedUnit: "EUR/POD/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "ARIM", customerScope: bta6Scope, normalizedUnit: "EUR/KW/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "ARIM", customerScope: bta6Scope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
];

const asosDomains: readonly RegulatoryRefreshDomain[] = asosVariants.flatMap((regulatoryVariant) => ([
  { componentCode: "ASOS" as const, customerScope: bta6Scope, normalizedUnit: "EUR/POD/YEAR" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
  { componentCode: "ASOS" as const, customerScope: bta6Scope, normalizedUnit: "EUR/KW/YEAR" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
  { componentCode: "ASOS" as const, customerScope: bta6Scope, normalizedUnit: "EUR/KWH" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
]));

/** Single source of truth shared by the economic calculator and refresh service. */
export const CALCULATED_REGULATORY_DOMAINS: readonly RegulatoryRefreshDomain[] = Object.freeze([...residentDomains, ...bta6Domains, ...asosDomains]);
export const AUTO_REFRESH_REGISTERED_DOMAINS = CALCULATED_REGULATORY_DOMAINS;

export function regulatoryDomainKey(domain: Pick<RegulatoryRefreshDomain, "componentCode" | "customerScope" | "normalizedUnit" | "regulatoryVariant">): string {
  return domain.regulatoryVariant === undefined
    ? `${domain.componentCode}|${domain.customerScope}|${domain.normalizedUnit}`
    : `${domain.componentCode}|${domain.customerScope}|${domain.normalizedUnit}|${domain.regulatoryVariant}`;
}

const registeredKeys = new Set(CALCULATED_REGULATORY_DOMAINS.map(regulatoryDomainKey));

export function isCalculatedRegulatoryDomain(domain: Pick<RegulatoryRefreshDomain, "componentCode" | "customerScope" | "normalizedUnit" | "regulatoryVariant">): boolean {
  return registeredKeys.has(regulatoryDomainKey(domain));
}

export function assertCalculatedRegulatoryDomain(domain: Pick<RegulatoryRefreshDomain, "componentCode" | "customerScope" | "normalizedUnit" | "regulatoryVariant">): void {
  if (!isCalculatedRegulatoryDomain(domain)) throw new Error("REGULATORY_REFRESH_DOMAIN_UNREGISTERED");
}

export function assertAutoRefreshCoverage(domains: readonly RegulatoryRefreshDomain[] = CALCULATED_REGULATORY_DOMAINS): void {
  const registered = new Set(AUTO_REFRESH_REGISTERED_DOMAINS.map(regulatoryDomainKey));
  for (const domain of domains) if (!registered.has(regulatoryDomainKey(domain))) throw new Error(`REGULATORY_REFRESH_DOMAIN_UNREGISTERED:${regulatoryDomainKey(domain)}`);
}
