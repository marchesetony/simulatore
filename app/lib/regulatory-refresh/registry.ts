import type { RegulatoryCustomerScope, RegulatoryValueComponentCode, RegulatoryVariant } from "../foundation/regulatory-types.ts";

export interface RegulatoryRefreshDomain {
  readonly componentCode: RegulatoryValueComponentCode;
  readonly customerScope: RegulatoryCustomerScope;
  readonly normalizedUnit: "EUR/KWH" | "EUR/KW/YEAR" | "EUR/POD/YEAR";
  readonly regulatoryVariant?: RegulatoryVariant;
  readonly sourceAdapter: "ARERA_ELECTRICITY" | "TERNA_CAPACITY";
}

export const REGULATORY_REFRESH_FREQUENCY = "DAILY" as const;
export const REGULATORY_REFRESH_CRON = "15 3 * * *" as const;
// ARERA and Terna values must be refreshed at least every 15 days (Tony, 26/10: "devono aggiornarsi ogni 15 giorni
// tassativamente"): the check runs daily and a source not confirmed for more than 15 days is stale.
export const REGULATORY_REFRESH_STALE_DAYS = 15 as const;

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

// Tony (29/10, BE FAMILY FAST 26): "ancora esiste dato non letto arera". Non-resident households pay the same TD transport
// and UC3/UC6 as residents, plus ASOS and ARIM with a quota fissa (€/POD/anno) and a quota energia (ARERA tables, row
// "domestico non residente"); their CDISPD is the households' one, read from the resident CDISPD records.
const nonResidentScope = "DOMESTIC_NON_RESIDENT_BT" as const;
const nonResidentDomains: readonly RegulatoryRefreshDomain[] = [
  { componentCode: "ASOS", customerScope: nonResidentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "ASOS", customerScope: nonResidentScope, normalizedUnit: "EUR/POD/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "ARIM", customerScope: nonResidentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "ARIM", customerScope: nonResidentScope, normalizedUnit: "EUR/POD/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "UC3", customerScope: nonResidentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "UC6", customerScope: nonResidentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "UC6", customerScope: nonResidentScope, normalizedUnit: "EUR/KW/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "NETWORK_FIXED", customerScope: nonResidentScope, normalizedUnit: "EUR/POD/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "NETWORK_POWER", customerScope: nonResidentScope, normalizedUnit: "EUR/KW/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "TRANSMISSION_ENERGY", customerScope: nonResidentScope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
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

// Tony (30/10, AZIENDA PROTETTA 3 kW): "credo ci siano errori ancora", rete and oneri not verified on ARERA. BT other uses up
// to 16,5 kW: distribution per class BTA1-BTA5 (TIT Tabella 3), metering and transmission of the whole BT other-uses
// category, UC3/UC6 and ARIM of the row "fino a 16,5 kW", ASOS per class of agevolazione.
const btaUpTo165Scope = "NON_DOMESTIC_BT_BTA1_5" as const;
const btaUpTo165Classes = ["BTA1", "BTA2", "BTA3", "BTA4", "BTA5"] as const;
const btaUpTo165Domains: readonly RegulatoryRefreshDomain[] = [
  ...btaUpTo165Classes.flatMap((regulatoryVariant) => ([
    { componentCode: "NETWORK_FIXED" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/POD/YEAR" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
    { componentCode: "NETWORK_POWER" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/KW/YEAR" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
    { componentCode: "NETWORK_ENERGY" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/KWH" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
  ])),
  { componentCode: "METERING_FIXED", customerScope: btaUpTo165Scope, normalizedUnit: "EUR/POD/YEAR", sourceAdapter: "ARERA_ELECTRICITY" },
  { componentCode: "TRANSMISSION_ENERGY", customerScope: btaUpTo165Scope, normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" },
  // Tony (30/10, "ancora errori"): ARERA's 588 Tabelle 6-7 and the ASOS tables split the "fino a 16,5 kW" row by
  // potenza impegnata (≤1,5 / 1,5-3 / 3-6 / 6-10 / >10 kW), so every onere has one domain per BTA class.
  ...btaUpTo165Classes.flatMap((regulatoryVariant) => ([
    { componentCode: "UC3" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/KWH" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
    { componentCode: "UC6" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/KWH" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
    { componentCode: "UC6" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/POD/YEAR" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
    { componentCode: "UC6" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/KW/YEAR" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
    { componentCode: "ARIM" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/POD/YEAR" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
    { componentCode: "ARIM" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/KW/YEAR" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
    { componentCode: "ARIM" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/KWH" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
  ])),
  ...asosVariants.flatMap((asosVariant) => btaUpTo165Classes.flatMap((tariffClass) => {
    const regulatoryVariant = `${asosVariant as "ASOS_CLASS_0" | "ASOS_CLASS_1" | "ASOS_CLASS_2" | "ASOS_CLASS_3"}_${tariffClass}` as const;
    return [
      { componentCode: "ASOS" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/POD/YEAR" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
      { componentCode: "ASOS" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/KW/YEAR" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
      { componentCode: "ASOS" as const, customerScope: btaUpTo165Scope, normalizedUnit: "EUR/KWH" as const, regulatoryVariant, sourceAdapter: "ARERA_ELECTRICITY" as const },
    ];
  })),
];

/** Single source of truth shared by the economic calculator and refresh service. */
export const CALCULATED_REGULATORY_DOMAINS: readonly RegulatoryRefreshDomain[] = Object.freeze([...residentDomains, ...nonResidentDomains, ...bta6Domains, ...asosDomains, ...btaUpTo165Domains]);
export const AUTO_REFRESH_REGISTERED_DOMAINS = CALCULATED_REGULATORY_DOMAINS;

/** Quarterly Terna capacity-market charges that CTEs pass through to the customer. */
export const TERNA_CAPACITY_DOMAINS: readonly RegulatoryRefreshDomain[] = Object.freeze([residentScope, bta6Scope].flatMap((customerScope) => (["CAPACITY_MARKET_OFF_PEAK", "CAPACITY_MARKET_PEAK"] as const).map((componentCode) => ({ componentCode, customerScope, normalizedUnit: "EUR/KWH" as const, sourceAdapter: "TERNA_CAPACITY" as const }))));

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

/** The monthly ARERA capacity charge for BT up to 55 kW (TIV quarterly updates, art. 4.1), read from each resolution. */
export const ARERA_CAPACITY_DOMAIN: RegulatoryRefreshDomain = Object.freeze({ componentCode: "CAPACITY_MARKET", customerScope: "ALL_ELECTRICITY", normalizedUnit: "EUR/KWH", sourceAdapter: "ARERA_ELECTRICITY" });

/** Terna's quarterly TIDE dispatching total for customers other than households. */
export const TERNA_TIDE_DOMAIN: RegulatoryRefreshDomain = Object.freeze({ componentCode: "DISPATCHING_TOTAL", customerScope: "NON_DOMESTIC_BT", normalizedUnit: "EUR/KWH", regulatoryVariant: "TIDE", sourceAdapter: "TERNA_CAPACITY" });
