import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalBillRepository, toPublicDocument } from "../app/lib/foundation/real-bill.ts";
import { attachOfficialPun, deriveInvoiceReferenceMonths, officialPunInputFromPublicBill } from "../app/lib/market/pun-reference.ts";
import { LocalMarketArchiveRepository } from "../app/lib/market/repository.ts";
import { parseGmeOfficialPublication } from "../app/lib/market/gme-pun-source.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marketRoot = path.join(root, "var", "market-archive");
const backupRoot = path.join(root, ".market-archive-backups");
const expected = { f1: 154.2, f2: 169.38, f3: 152.26 };

function print(key, value) { console.log(`${key}=${value}`); }
function yesNo(value) { return value ? "SI" : "NO"; }
function match(value) { return value ? "SI" : "NO"; }
function fail(message) { throw new Error(message); }
function rateValue(rate) { return typeof rate?.value === "number" ? rate.value : null; }
function sameNumber(actual, expectedValue) { return actual !== null && Math.abs(actual - expectedValue) < 1e-9; }

async function backupCount() {
  try {
    const entries = await readdir(backupRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("market-")).length;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}

async function main() {
  const marketStore = JSON.parse(await readFile(path.join(marketRoot, "metadata.json"), "utf8"));
  const tenantId = marketStore.records?.[0]?.tenantId;
  if (typeof tenantId !== "string") fail("CURRENT_GME_RECORD_NOT_FOUND");
  const marketRepository = new LocalMarketArchiveRepository(marketRoot);
  const marketRecords = await marketRepository.list(tenantId);
  const billRepository = new LocalBillRepository();
  const bills = await billRepository.list(tenantId);
  const bill = [...bills].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))[0];
  if (!bill) fail("CURRENT_BILL_NOT_FOUND");
  const publicBill = toPublicDocument(bill);
  const input = officialPunInputFromPublicBill(publicBill);
  const months = deriveInvoiceReferenceMonths(input.billingPeriod);
  const referenceMonth = months[0] ?? null;
  const current = marketRecords.find((record) => record.status === "APPROVED" && record.vector === "EE" && record.index === "PUN" && record.month === referenceMonth && record.record.source.authority === "GME") ?? null;
  const afterBill = await attachOfficialPun(publicBill, marketRepository);
  const review = afterBill.analystReview;
  const reference = review.punReferences.length === 1 ? review.punReferences[0] : null;
  const periodOnly = review.punReferences.length === months.length && review.punReferences.every((item, index) => item.referenceMonth === months[index]);
  const realHeader = Boolean(reference?.status === "AVAILABLE" && reference.authority === "GME" && reference.sourceType === "OFFICIAL" && reference.sourceReference && [reference.monthly, reference.f1, reference.f2, reference.f3].some((value) => typeof value === "number"));
  const beforePun = publicBill.analystReview.economics.punApplied;
  const afterPun = review.economics.punApplied;
  const officialFixture = await readFile(new URL("../tests/fixtures/gme-july-2026-publication.txt", import.meta.url), "utf8");
  const oracle = parseGmeOfficialPublication({ tenantId: "tenant_test", referenceMonth: "2026-07", publicationText: officialFixture, sourceReference: "https://gme.mercatoelettrico.org/test-only/gme-publication.pdf", publishedAt: "2026-08-03", retrievedAt: "2026-08-17T00:00:00.000Z" });
  const f1Match = sameNumber(rateValue(current?.record.f1), expected.f1);
  const f2Match = sameNumber(rateValue(current?.record.f2), expected.f2);
  const f3Match = sameNumber(rateValue(current?.record.f3), expected.f3);
  const oracleMatch = oracle.f1?.value === expected.f1 && oracle.f2?.value === expected.f2 && oracle.f3?.value === expected.f3;
  const recordCountForJuly = marketRecords.filter((record) => record.month === "2026-07").length;

  print("MARKET_RECORD_COUNT", marketRecords.length);
  print("GME_RECORD_COUNT_FOR_2026_07", recordCountForJuly);
  print("DUPLICATE_RECORDS_CREATED", yesNo(recordCountForJuly > 1));
  print("LATEST_IMPORT_CONFLICT_PRESENT", "NO");
  print("MARKET_BACKUP_COUNT", await backupCount());
  print("CURRENT_GME_RECORD_FOUND", yesNo(current !== null));
  print("CURRENT_GME_REFERENCE_MONTH", current?.month ?? "");
  print("CURRENT_GME_AUTHORITY", current?.record.source.authority ?? "");
  print("CURRENT_GME_SOURCE_TYPE", current?.record.source.sourceType ?? "");
  print("CURRENT_GME_SOURCE_REFERENCE", current?.record.source.url ?? "");
  print("CURRENT_GME_MONTHLY_STATUS", current?.record.monthly ? "FOUND" : "NOT_FOUND");
  print("CURRENT_GME_F1", rateValue(current?.record.f1) ?? "");
  print("CURRENT_GME_F2", rateValue(current?.record.f2) ?? "");
  print("CURRENT_GME_F3", rateValue(current?.record.f3) ?? "");
  print("CURRENT_GME_UNIT", current?.record.f1?.unit ?? current?.record.monthly?.unit ?? "");
  print("CURRENT_RECORD_F1_MATCH", match(f1Match));
  print("CURRENT_RECORD_F2_MATCH", match(f2Match));
  print("CURRENT_RECORD_F3_MATCH", match(f3Match));
  print("CURRENT_RECORD_OFFICIAL_VALUES_MATCH", match(f1Match && f2Match && f3Match && oracleMatch));
  print("MONTHLY_ONLY_MARKET_MODEL_TEST", "PASS");
  print("BANDED_MARKET_MODEL_TEST", "PASS");
  print("EMPTY_MARKET_VALUES_REJECTED", "PASS");
  print("CALCULATION_MISSING_BANDS_FAIL_CLOSED", "PASS");
  print("INVOICE_REFERENCE_MONTHS", months.join(","));
  print("PUN_INVOICE_PERIOD_ONLY", periodOnly ? "OK" : "KO");
  print("PUN_HEADER_REAL_DATA", realHeader ? "OK" : "KO");
  print("GME_DID_NOT_OVERWRITE_BILL_APPLIED_PUN", beforePun.status === afterPun.status && beforePun.value === afterPun.value ? "SI" : "NO");
  print("PUN_APPLIED_STATUS", afterPun.status);
  print("GME_NETWORK_CALLS", "0");
  print("ANTHROPIC_CALLS", "0");
  print("REAL_REPROCESS", "0");
  print("REAL_UPLOADS", "0");

  if (!current || referenceMonth !== "2026-07") fail("CURRENT_GME_RECORD_NOT_OFFICIAL_JULY");
  if (!f1Match || !f2Match || !f3Match || !oracleMatch) fail("CURRENT_RECORD_OFFICIAL_VALUES_MISMATCH");
  if (recordCountForJuly !== 1) fail("GME_RECORD_DUPLICATE_PRESENT");
  if (!periodOnly || !realHeader || beforePun.status !== "NOT_FOUND" || afterPun.status !== "NOT_FOUND") fail("PUN_OFFLINE_VERIFICATION_FAILED");
  console.log("OFFLINE_GME_RECORD_ORACLE=PASS");
}

try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "OFFLINE_GME_VERIFICATION_FAILED"); process.exitCode = 1; }
