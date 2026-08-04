import type { BillRepository, DocumentStoragePort } from "../foundation/real-bill";
import type { CteArchiveRepository as DomainCteArchiveRepository } from "../cte/archive/types";
import type { MarketArchiveRepository as DomainMarketArchiveRepository } from "../market/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { LocalBillRepository, LocalDocumentStorage } from "../foundation/real-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { LocalCteArchiveRepository } from "../cte/archive/repository.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { LocalMarketArchiveRepository } from "../market/repository.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { getRuntimeConfig } from "../auth/config.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { LocalFilesystemAdapter } from "./local.ts";
import type { AuditEventRepository, CalculationResultRepository, CommercialProposalRepository, ComparisonResultRepository, ExportMetadataRepository, BillIngestionMetadata, NormalizedBillSnapshot, TenantRecordRepository } from "./types";

export interface ProductionStorageAdapter {
  readonly kind: "provider";
  readonly cteArchiveRepository: DomainCteArchiveRepository;
  readonly marketArchiveRepository: DomainMarketArchiveRepository;
  readonly billRepository: BillRepository;
  readonly documentStorage: DocumentStoragePort;
  readonly billIngestionMetadata: TenantRecordRepository<BillIngestionMetadata>;
  readonly normalizedBillSnapshots: TenantRecordRepository<NormalizedBillSnapshot>;
  readonly cteArchives: TenantRecordRepository<unknown>;
  readonly marketDataArchives: TenantRecordRepository<unknown>;
  readonly calculationResults: CalculationResultRepository;
  readonly comparisonResults: ComparisonResultRepository;
  readonly proposals: CommercialProposalRepository;
  readonly exports: ExportMetadataRepository;
  readonly auditEvents: AuditEventRepository;
}

export interface RuntimeRepositories {
  readonly cteArchiveRepository: DomainCteArchiveRepository;
  readonly marketArchiveRepository: DomainMarketArchiveRepository;
  readonly billRepository: BillRepository;
  readonly documentStorage: DocumentStoragePort;
  readonly billIngestionMetadata: TenantRecordRepository<BillIngestionMetadata>;
  readonly normalizedBillSnapshots: TenantRecordRepository<NormalizedBillSnapshot>;
  readonly cteArchives: TenantRecordRepository<unknown>;
  readonly marketDataArchives: TenantRecordRepository<unknown>;
  readonly calculationResults: CalculationResultRepository;
  readonly comparisonResults: ComparisonResultRepository;
  readonly proposals: CommercialProposalRepository;
  readonly exports: ExportMetadataRepository;
  readonly auditEvents: AuditEventRepository;
}

let productionStorageAdapter: ProductionStorageAdapter | null = null;
function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  return methods.every((method) => typeof (value as Record<string, unknown>)[method] === "function");
}

function isProductionStorageAdapter(adapter: unknown): adapter is ProductionStorageAdapter {
  if (typeof adapter !== "object" || adapter === null || (adapter as Record<string, unknown>).kind !== "provider") return false;
  const item = adapter as Record<string, unknown>;
  return hasMethods(item.cteArchiveRepository, ["get", "list", "save"])
    && hasMethods(item.marketArchiveRepository, ["get", "list", "save"])
    && hasMethods(item.billRepository, ["get", "list", "save"])
    && hasMethods(item.documentStorage, ["store", "read"])
    && ["billIngestionMetadata", "normalizedBillSnapshots", "cteArchives", "marketDataArchives", "calculationResults", "comparisonResults", "proposals", "exports", "auditEvents"].every((name) => hasMethods(item[name], ["get", "list", "put", "append"]));
}

export function registerProductionStorageAdapter(adapter: ProductionStorageAdapter): void {
  if (!isProductionStorageAdapter(adapter)) throw new Error("PERSISTENCE_ADAPTER_INVALID");
  if (!hasMethods(adapter.auditEvents, ["appendUnscoped"])) throw new Error("PERSISTENCE_ADAPTER_INVALID");
  productionStorageAdapter = adapter;
}
export function clearProductionStorageAdapter(): void { productionStorageAdapter = null; }
export function productionStorageAdapterConfigured(): boolean { return productionStorageAdapter !== null; }

export function runtimeRepositories(): RuntimeRepositories {
  const config = getRuntimeConfig();
  if (config.runtimeMode === "production") {
    if (!productionStorageAdapter) throw new Error("PERSISTENCE_ADAPTER_UNAVAILABLE");
    return productionStorageAdapter;
  }
  const local = new LocalFilesystemAdapter("var/phase6");
  return {
    cteArchiveRepository: new LocalCteArchiveRepository(),
    marketArchiveRepository: new LocalMarketArchiveRepository(),
    billRepository: new LocalBillRepository(process.env.FOUNDATION_DOCUMENTS_ROOT),
    documentStorage: new LocalDocumentStorage(process.env.FOUNDATION_DOCUMENTS_ROOT),
    billIngestionMetadata: local.collection("bill-ingestion-metadata"),
    normalizedBillSnapshots: local.collection("normalized-bill-snapshots"),
    cteArchives: local.collection("cte-archives"),
    marketDataArchives: local.collection("market-data-archives"),
    calculationResults: local.collection("calculations"),
    comparisonResults: local.collection("comparisons"),
    proposals: local.collection("proposals"),
    exports: local.collection("exports"),
    auditEvents: local.collection("audit-events"),
  };
}
