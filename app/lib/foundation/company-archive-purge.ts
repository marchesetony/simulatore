import type { BillRepository, DocumentStoragePort } from "./real-bill";
import type { CteArchiveRepository } from "../cte/archive/types";
import type { CteIngestionRepository } from "../cte/ingestion";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { deleteBillPermanently } from "./bill-retention.ts";

// Tony (31/10): "eliminiamo tutti gli archivi bolletta e cte, in modo da avere una pulizia totale e ricomenciare con tutto
// nuovo"; asked whether for his company only or for every company, he chose his company only ("a"), and: "gli archivi
// arera, terna gme, tutti i dati di mercato li gestisce solo l'azienda, no il cliente che compra l'app. il cliente gestisce
// solo fatture e cte". The purge removes the company's bills, CTEs and their PDFs for good; official data is never touched.

export const ARCHIVE_PURGE_CONFIRMATION = "SVUOTA";

export interface CompanyArchivePurgeRepositories {
  readonly bills: BillRepository;
  readonly ctes: CteArchiveRepository;
  readonly cteIngestions: CteIngestionRepository;
  readonly storage: DocumentStoragePort;
  readonly audit: { record(event: { readonly type: string; readonly documentId: string; readonly outcome: string }): Promise<void> };
}

export interface CompanyArchivePurgeResult { readonly bills: number; readonly ctes: number; readonly cteDocuments: number; readonly failed: number }

const notFound = (error: unknown) => /NOT_FOUND|ENOENT/.test(error instanceof Error ? error.message : String(error));

export async function purgeCompanyArchive(input: { readonly tenantId: string; readonly confirmation: string; readonly repositories: CompanyArchivePurgeRepositories }): Promise<CompanyArchivePurgeResult> {
  if (input.confirmation !== ARCHIVE_PURGE_CONFIRMATION) throw new Error("ARCHIVE_PURGE_CONFIRMATION_REQUIRED");
  const removeCte = input.repositories.ctes.remove?.bind(input.repositories.ctes);
  if (!removeCte || !input.repositories.bills.delete) throw new Error("ARCHIVE_PURGE_UNAVAILABLE");
  const { repositories, tenantId } = input;
  let bills = 0; let ctes = 0; let cteDocuments = 0; let failed = 0;
  for (const bill of await repositories.bills.list(tenantId)) {
    if (bill.tenantId !== tenantId) continue;
    try { await deleteBillPermanently({ tenantId, documentId: bill.id, repositories: { bills: repositories.bills, storage: repositories.storage, audit: repositories.audit } }); bills += 1; } catch { failed += 1; }
  }
  const removedPdfs = new Set<string>();
  for (const record of await repositories.cteIngestions.list(tenantId)) {
    try {
      if (!removedPdfs.has(record.payload.documentId)) {
        try { await repositories.storage.remove(tenantId, record.payload.documentId); } catch (error) { if (!notFound(error)) throw error; }
        removedPdfs.add(record.payload.documentId);
      }
      await repositories.cteIngestions.delete({ tenantId, recordId: record.recordId, expectedVersion: record.version });
      cteDocuments += 1;
      await repositories.audit.record({ type: "CTE_DOCUMENT_PURGED", documentId: record.recordId, outcome: "ALLOWED" });
    } catch { failed += 1; }
  }
  for (const archive of await repositories.ctes.list(tenantId)) {
    if (archive.tenantId !== tenantId) continue;
    try { await removeCte(tenantId, archive.archiveId); ctes += 1; await repositories.audit.record({ type: "CTE_ARCHIVE_PURGED", documentId: archive.archiveId, outcome: "ALLOWED" }); } catch { failed += 1; }
  }
  return { bills, ctes, cteDocuments, failed };
}
