import type { RegulatoryRepository } from "../foundation/regulatory-ports.ts";
import type { RegulatoryCustomerScope, RegulatoryValueComponentCode, RegulatoryValueRecord } from "../foundation/regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ARERA_SYSTEM_CHARGES_PAGE, createRegulatoryValue, fetchOfficialBta6Sources, fetchOfficialBtaUpTo165Sources, AreraElectricityRegulatorySourceAdapter, fetchAreraDomesticCdispdWorkbook, parseAreraDomesticCdispdXlsx, type AreraFetcher, DOMESTIC_EQUAL_RATE_APPLICATION_BASIS } from "../foundation/arera-electricity-regulatory.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { CALCULATED_REGULATORY_DOMAINS, regulatoryDomainKey, type RegulatoryRefreshDomain } from "./registry.ts";

export interface RegulatorySourceReader {
  readonly adapterName: "ARERA_ELECTRICITY";
  load(input: { readonly tenantId: string; readonly retrievedAt: string }): Promise<readonly RegulatoryValueRecord[]>;
  /** The sources (or monthly sheets) the last load could not read, while the others were still loaded. */
  lastErrors?(): readonly string[];
}

function exactScopeRecord(record: RegulatoryValueRecord, customerScope: RegulatoryCustomerScope): RegulatoryValueRecord {
  return createRegulatoryValue({
    tenantId: record.tenantId,
    sourceType: record.sourceType,
    sourceReference: record.sourceReference,
    officialIdentifier: record.officialIdentifier,
    publicationDate: record.publicationDate,
    retrievedAt: record.retrievedAt,
    effectiveFrom: record.effectiveFrom,
    effectiveTo: record.effectiveTo,
    componentCode: record.componentCode,
    customerScope,
    originalValue: record.originalValue,
    originalUnit: record.originalUnit,
    applicationBasis: record.applicationBasis,
    sourceSha256: record.sourceSha256,
    conversionProvenance: record.conversionProvenance,
    carriedForwardFrom: record.carriedForwardFrom,
    confirmationSource: record.confirmationSource,
    regulatoryVariant: record.regulatoryVariant,
    authority: record.authority,
    publishedBy: record.publishedBy === "TERNA" ? "TERNA" : record.publishedBy === undefined ? undefined : "ARERA",
    calculatedBy: record.calculatedBy === "TERNA" ? "TERNA" : record.calculatedBy === undefined ? undefined : "ARERA",
    officialName: record.officialName,
    contractPassThroughRequired: record.contractPassThroughRequired,
    referenceDomain: record.referenceDomain,
  });
}

function sink(): RegulatoryRepository {
  const unsupported = async (): Promise<never> => { throw new Error("ARERA_REFRESH_SINK_UNSUPPORTED"); };
  return { saveRegulatoryValue: async () => "REUSED", getRegulatoryValues: async () => [], isAllowed: () => true, get: async () => null, save: unsupported, importDocument: unsupported, importRule: unsupported, importSeries: unsupported, approve: unsupported, put: unsupported, getEvidence: async () => null, getReview: async () => null, getVersionState: async () => null, getDocument: async () => null, getCurrentSource: async () => null, getDocumentVersion: async () => null, getRule: async () => null, getSeries: async () => null, getSeriesVersion: async () => null, getSeriesHistory: async () => [], getPoints: async () => [], getPointVersions: async () => [], getPointHistory: async () => [] } as unknown as RegulatoryRepository;
}

/** Reads the currently published ARERA sources and materializes only exact calculator domains. */
export function createAreraRegulatorySourceReader(input: { readonly fetcher?: AreraFetcher } = {}): RegulatorySourceReader {
  let errors: string[] = [];
  // Tony (28/10): "sono dati che si devono aggiornare in automatico". Each ARERA source is read on its own: one that fails
  // (a page moved, a new layout) is reported in the refresh errors and the others are still archived.
  const attempt = async <T>(source: string, read: () => Promise<T>): Promise<T | null> => {
    try { return await read(); } catch (error) { errors.push(`${source}:${error instanceof Error ? error.message : "ARERA_SOURCE_UNREADABLE"}`); return null; }
  };
  return {
    adapterName: "ARERA_ELECTRICITY",
    lastErrors: () => errors,
    async load({ tenantId, retrievedAt }): Promise<readonly RegulatoryValueRecord[]> {
      errors = [];
      const bta6 = await attempt("ARERA_BTA6", () => fetchOfficialBta6Sources({ tenantId, retrievedAt, fetcher: input.fetcher }));
      const upTo165 = await attempt("ARERA_BTA1_5", () => fetchOfficialBtaUpTo165Sources({ tenantId, retrievedAt, fetcher: input.fetcher }));
      upTo165?.errors.forEach((error) => errors.push(error));
      const cdispd = await attempt("ARERA_CDISPD", async () => {
        const workbook = await fetchAreraDomesticCdispdWorkbook(input.fetcher);
        return parseAreraDomesticCdispdXlsx({ body: workbook.bytes, sourceReference: workbook.url, retrievedAt, tenantId, sourceSha256: undefined, discoveryReference: workbook.discoveryUrl });
      });
      cdispd?.errors.forEach((error) => errors.push(`ARERA_CDISPD:${error}`));
      const current = await attempt("ARERA_TARIFFS", async () => {
        try {
          return await new AreraElectricityRegulatorySourceAdapter(sink(), { tenantId, fetcher: input.fetcher, systemChargesPage: ARERA_SYSTEM_CHARGES_PAGE, includeBta6Uc: true, includeBta6Arim: true }).importOfficial({ retrievedAt });
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "ARERA_HTTP_404") throw error;
          return await new AreraElectricityRegulatorySourceAdapter(sink(), { tenantId, fetcher: input.fetcher, includeBta6Uc: true, includeBta6Arim: true }).importOfficial({ retrievedAt });
        }
      });
      current?.skippedDecisions.forEach((error) => errors.push(`ARERA_TARIFFS:${error}`));
      if (!bta6 && !upTo165 && !cdispd && !current) throw new Error(errors[0] ?? "ARERA_SOURCES_UNREADABLE");
      const infrastructure = new Map((current?.infrastructure.records ?? []).map((record) => [record.componentCode, record]));
      const system = current?.systemChargeRecords ?? [];
      const bta6Uc3 = system.find((record) => record.componentCode === "UC3" && record.customerScope === "NON_DOMESTIC_BT_BTA6" && record.normalizedUnit === "EUR/KWH");
      const bta6Uc6Energy = system.find((record) => record.componentCode === "UC6" && record.customerScope === "NON_DOMESTIC_BT_BTA6" && record.normalizedUnit === "EUR/KWH");
      const bta6Uc6Fixed = system.find((record) => record.componentCode === "UC6" && record.customerScope === "NON_DOMESTIC_BT_BTA6" && record.normalizedUnit === "EUR/POD/YEAR");
      const bta6ArimFixed = system.find((record) => record.componentCode === "ARIM" && record.customerScope === "NON_DOMESTIC_BT_BTA6" && record.normalizedUnit === "EUR/POD/YEAR");
      const bta6ArimPower = system.find((record) => record.componentCode === "ARIM" && record.customerScope === "NON_DOMESTIC_BT_BTA6" && record.normalizedUnit === "EUR/KW/YEAR");
      const bta6ArimEnergy = system.find((record) => record.componentCode === "ARIM" && record.customerScope === "NON_DOMESTIC_BT_BTA6" && record.normalizedUnit === "EUR/KWH");
      const residentSource: Partial<Record<RegulatoryValueComponentCode, RegulatoryValueRecord>> = {
        NETWORK_FIXED: infrastructure.get("S1_TOTAL") ? exactScopeRecord({ ...infrastructure.get("S1_TOTAL")!, componentCode: "NETWORK_FIXED" }, "DOMESTIC_RESIDENT_BT") : undefined,
        NETWORK_POWER: infrastructure.get("S2_POWER") ? exactScopeRecord({ ...infrastructure.get("S2_POWER")!, componentCode: "NETWORK_POWER" }, "DOMESTIC_RESIDENT_BT") : undefined,
        TRANSMISSION_ENERGY: infrastructure.get("S3_ENERGY_TRANSMISSION") ? exactScopeRecord({ ...infrastructure.get("S3_ENERGY_TRANSMISSION")!, componentCode: "TRANSMISSION_ENERGY" }, "DOMESTIC_RESIDENT_BT") : undefined,
        UC3: system.find((record) => record.componentCode === "UC3" && record.normalizedUnit === "EUR/KWH"),
      };
      const residentUc6Power = system.find((record) => record.componentCode === "UC6" && record.normalizedUnit === "EUR/KW/YEAR");
      const residentUc6Energy = system.find((record) => record.componentCode === "UC6" && record.normalizedUnit === "EUR/KWH");
      const residentAsos = system.filter((record) => record.componentCode === "ASOS" && record.customerScope === "DOMESTIC_RESIDENT_BT" && record.normalizedUnit === "EUR/KWH").sort((left, right) => Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom))[0];
      const residentArim = system.filter((record) => record.componentCode === "ARIM" && record.customerScope === "DOMESTIC_RESIDENT_BT" && record.normalizedUnit === "EUR/KWH").sort((left, right) => Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom))[0];
      if (residentAsos && !residentAsos.applicationBasis.includes(DOMESTIC_EQUAL_RATE_APPLICATION_BASIS)) throw new Error("DOMESTIC_ASOS_APPLICATION_BASIS_INVALID");
      if (residentArim && !residentArim.applicationBasis.includes(DOMESTIC_EQUAL_RATE_APPLICATION_BASIS)) throw new Error("DOMESTIC_ARIM_APPLICATION_BASIS_INVALID");
      // Non-resident households: ASOS and ARIM from their own ARERA row; transport and UC3/UC6 are the domestic TD ones.
      const nonResident = (componentCode: "ASOS" | "ARIM", normalizedUnit: "EUR/KWH" | "EUR/POD/YEAR") => system.filter((record) => record.componentCode === componentCode && record.customerScope === "DOMESTIC_NON_RESIDENT_BT" && record.normalizedUnit === normalizedUnit).sort((left, right) => componentCode === "ASOS" ? Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom) : Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom))[0];
      const nonResidentSource: Record<string, RegulatoryValueRecord | undefined> = { "ASOS|EUR/KWH": nonResident("ASOS", "EUR/KWH"), "ASOS|EUR/POD/YEAR": nonResident("ASOS", "EUR/POD/YEAR"), "ARIM|EUR/KWH": nonResident("ARIM", "EUR/KWH"), "ARIM|EUR/POD/YEAR": nonResident("ARIM", "EUR/POD/YEAR") };
      const bta6Asos = Object.fromEntries(system.filter((record) => record.componentCode === "ASOS" && record.customerScope === "NON_DOMESTIC_BT_BTA6" && record.regulatoryVariant !== undefined).map((record) => [`${record.componentCode}|${record.customerScope}|${record.normalizedUnit}|${record.regulatoryVariant}`, record]));
      // BT other uses up to 16,5 kW: metering and transmission are those of the whole BT other-uses category (BTA6 records).
      const upTo165Records = [...(upTo165?.distribution ?? []), ...(upTo165?.uc ?? []), ...(upTo165?.arim ?? []), ...system.filter((record) => record.customerScope === "NON_DOMESTIC_BT_BTA1_5")];
      const upTo165Source: Record<string, RegulatoryValueRecord | undefined> = {
        ...Object.fromEntries(upTo165Records.map((record) => [regulatoryDomainKey(record as Parameters<typeof regulatoryDomainKey>[0]), record])),
        "METERING_FIXED|NON_DOMESTIC_BT_BTA1_5|EUR/POD/YEAR": bta6?.metering ? exactScopeRecord(bta6.metering, "NON_DOMESTIC_BT_BTA1_5") : undefined,
        "TRANSMISSION_ENERGY|NON_DOMESTIC_BT_BTA1_5|EUR/KWH": bta6?.transmission ? exactScopeRecord(bta6.transmission, "NON_DOMESTIC_BT_BTA1_5") : undefined,
      };
      const records: RegulatoryValueRecord[] = [...(cdispd?.records ?? [])];
      for (const domain of CALCULATED_REGULATORY_DOMAINS) {
        const source = domain.customerScope === "NON_DOMESTIC_BT_BTA1_5" ? upTo165Source[regulatoryDomainKey(domain)]
          : domain.customerScope === "NON_DOMESTIC_BT_BTA6"
          ? ({ "NETWORK_FIXED|NON_DOMESTIC_BT_BTA6|EUR/POD/YEAR": bta6?.fixed, "NETWORK_POWER|NON_DOMESTIC_BT_BTA6|EUR/KW/YEAR": bta6?.power, "NETWORK_ENERGY|NON_DOMESTIC_BT_BTA6|EUR/KWH": bta6?.energy, "METERING_FIXED|NON_DOMESTIC_BT_BTA6|EUR/POD/YEAR": bta6?.metering, "TRANSMISSION_ENERGY|NON_DOMESTIC_BT_BTA6|EUR/KWH": bta6?.transmission, "UC3|NON_DOMESTIC_BT_BTA6|EUR/KWH": bta6Uc3, "UC6|NON_DOMESTIC_BT_BTA6|EUR/KWH": bta6Uc6Energy, "UC6|NON_DOMESTIC_BT_BTA6|EUR/POD/YEAR": bta6Uc6Fixed, "ARIM|NON_DOMESTIC_BT_BTA6|EUR/POD/YEAR": bta6ArimFixed, "ARIM|NON_DOMESTIC_BT_BTA6|EUR/KW/YEAR": bta6ArimPower, "ARIM|NON_DOMESTIC_BT_BTA6|EUR/KWH": bta6ArimEnergy, ...bta6Asos } as Record<string, RegulatoryValueRecord | undefined>)[regulatoryDomainKey(domain)]
          : domain.componentCode === "DISPATCHING_TOTAL" ? undefined
          : domain.customerScope === "DOMESTIC_NON_RESIDENT_BT" && (domain.componentCode === "ASOS" || domain.componentCode === "ARIM") ? nonResidentSource[`${domain.componentCode}|${domain.normalizedUnit}`]
          : domain.componentCode === "ASOS" ? residentAsos : domain.componentCode === "ARIM" ? residentArim : domain.componentCode === "UC6" && domain.normalizedUnit === "EUR/KW/YEAR" ? residentUc6Power : domain.componentCode === "UC6" ? residentUc6Energy : residentSource[domain.componentCode];
        if (domain.componentCode === "DISPATCHING_TOTAL") continue;
        if (!source || source.normalizedUnit !== domain.normalizedUnit) continue;
        records.push((domain.customerScope === "DOMESTIC_RESIDENT_BT" || domain.customerScope === "DOMESTIC_NON_RESIDENT_BT") && source.customerScope !== domain.customerScope ? exactScopeRecord(source, domain.customerScope) : source);
      }
      return records;
    },
  };
}

export function assertReaderDomain(domain: RegulatoryRefreshDomain, records: readonly RegulatoryValueRecord[]): RegulatoryValueRecord {
  const matches = recordsForDomain(domain, records);
  if (matches.length !== 1) throw new Error(`ARERA_REFRESH_SOURCE_DOMAIN_INVALID:${regulatoryDomainKey(domain)}`);
  return matches[0];
}

export function recordsForDomain(domain: RegulatoryRefreshDomain, records: readonly RegulatoryValueRecord[]): readonly RegulatoryValueRecord[] {
  const matches = records.filter((record) => record.componentCode === domain.componentCode && record.customerScope === domain.customerScope && record.normalizedUnit === domain.normalizedUnit && record.regulatoryVariant === domain.regulatoryVariant);
  if (matches.length === 0) throw new Error(`ARERA_REFRESH_SOURCE_DOMAIN_INVALID:${regulatoryDomainKey(domain)}`);
  return domain.componentCode === "DISPATCHING_TOTAL" ? [...matches].sort((left, right) => Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom)) : matches;
}
