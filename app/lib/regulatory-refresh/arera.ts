import type { RegulatoryRepository } from "../foundation/regulatory-ports.ts";
import type { RegulatoryCustomerScope, RegulatoryValueComponentCode, RegulatoryValueRecord } from "../foundation/regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ARERA_SYSTEM_CHARGES_PAGE, createRegulatoryValue, fetchOfficialBta6Sources, AreraElectricityRegulatorySourceAdapter, type AreraFetcher } from "../foundation/arera-electricity-regulatory.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { CALCULATED_REGULATORY_DOMAINS, regulatoryDomainKey, type RegulatoryRefreshDomain } from "./registry.ts";

export interface RegulatorySourceReader {
  readonly adapterName: "ARERA_ELECTRICITY";
  load(input: { readonly tenantId: string; readonly retrievedAt: string }): Promise<readonly RegulatoryValueRecord[]>;
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
  return {
    adapterName: "ARERA_ELECTRICITY",
    async load({ tenantId, retrievedAt }): Promise<readonly RegulatoryValueRecord[]> {
      const bta6 = await fetchOfficialBta6Sources({ tenantId, retrievedAt, fetcher: input.fetcher });
      let current: Awaited<ReturnType<AreraElectricityRegulatorySourceAdapter["importOfficial"]>>;
      try {
        const arera = new AreraElectricityRegulatorySourceAdapter(sink(), { tenantId, fetcher: input.fetcher, systemChargesPage: ARERA_SYSTEM_CHARGES_PAGE });
        current = await arera.importOfficial({ retrievedAt });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "ARERA_HTTP_404") throw error;
        const arera = new AreraElectricityRegulatorySourceAdapter(sink(), { tenantId, fetcher: input.fetcher });
        current = await arera.importOfficial({ retrievedAt });
      }
      const infrastructure = new Map(current.infrastructure.records.map((record) => [record.componentCode, record]));
      const system = current.systemChargeRecords;
      const residentSource: Partial<Record<RegulatoryValueComponentCode, RegulatoryValueRecord>> = {
        NETWORK_FIXED: infrastructure.get("S1_TOTAL") ? exactScopeRecord({ ...infrastructure.get("S1_TOTAL")!, componentCode: "NETWORK_FIXED" }, "DOMESTIC_RESIDENT_BT") : undefined,
        NETWORK_POWER: infrastructure.get("S2_POWER") ? exactScopeRecord({ ...infrastructure.get("S2_POWER")!, componentCode: "NETWORK_POWER" }, "DOMESTIC_RESIDENT_BT") : undefined,
        TRANSMISSION_ENERGY: infrastructure.get("S3_ENERGY_TRANSMISSION") ? exactScopeRecord({ ...infrastructure.get("S3_ENERGY_TRANSMISSION")!, componentCode: "TRANSMISSION_ENERGY" }, "DOMESTIC_RESIDENT_BT") : undefined,
        UC3: system.find((record) => record.componentCode === "UC3" && record.normalizedUnit === "EUR/KWH"),
      };
      const residentUc6Power = system.find((record) => record.componentCode === "UC6" && record.normalizedUnit === "EUR/KW/YEAR");
      const residentUc6Energy = system.find((record) => record.componentCode === "UC6" && record.normalizedUnit === "EUR/KWH");
      const records: RegulatoryValueRecord[] = [];
      for (const domain of CALCULATED_REGULATORY_DOMAINS) {
        const source = domain.customerScope === "NON_DOMESTIC_BT_BTA6"
          ? ({ "NETWORK_FIXED|NON_DOMESTIC_BT_BTA6|EUR/POD/YEAR": bta6.fixed, "NETWORK_POWER|NON_DOMESTIC_BT_BTA6|EUR/KW/YEAR": bta6.power, "NETWORK_ENERGY|NON_DOMESTIC_BT_BTA6|EUR/KWH": bta6.energy, "METERING_FIXED|NON_DOMESTIC_BT_BTA6|EUR/POD/YEAR": bta6.metering, "TRANSMISSION_ENERGY|NON_DOMESTIC_BT_BTA6|EUR/KWH": bta6.transmission } as Record<string, RegulatoryValueRecord>)[regulatoryDomainKey(domain)]
          : domain.componentCode === "UC6" && domain.normalizedUnit === "EUR/KW/YEAR" ? residentUc6Power : domain.componentCode === "UC6" ? residentUc6Energy : residentSource[domain.componentCode];
        if (!source || source.normalizedUnit !== domain.normalizedUnit) continue;
        records.push(domain.customerScope === "DOMESTIC_RESIDENT_BT" && source.customerScope !== domain.customerScope ? exactScopeRecord(source, domain.customerScope) : source);
      }
      return records;
    },
  };
}

export function assertReaderDomain(domain: RegulatoryRefreshDomain, records: readonly RegulatoryValueRecord[]): RegulatoryValueRecord {
  const matches = records.filter((record) => record.componentCode === domain.componentCode && record.customerScope === domain.customerScope && record.normalizedUnit === domain.normalizedUnit);
  if (matches.length !== 1) throw new Error(`ARERA_REFRESH_SOURCE_DOMAIN_INVALID:${regulatoryDomainKey(domain)}`);
  return matches[0];
}
