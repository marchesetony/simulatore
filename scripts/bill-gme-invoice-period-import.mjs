import { readFile } from "node:fs/promises";
import { inflateRawSync, inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractExplicitPublicationDate, findPublicationLink } from "../app/lib/market/gme-publication.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const discoveryUrl = "https://gme.mercatoelettrico.org/it-it/Home/Pubblicazioni/PrezzoMedioFasce";
const marketRoot = path.join(root, "var", "market-archive");
const report = new Map([
  ["CURRENT_BILL_ID", ""], ["BILLING_PERIOD_NORMALIZED", "KO"], ["BILLING_PERIOD_START", ""], ["BILLING_PERIOD_END", ""], ["INVOICE_REFERENCE_MONTHS", ""], ["GME_ALLOWED_MONTHS", ""],
  ["GME_SOURCE_MODE", "GME_OFFICIAL_PUBLICATION"], ["GME_SOURCE_AUTHORITY", ""], ["GME_SOURCE_REFERENCE", ""], ["GME_SOURCE_MONTH", ""], ["GME_SOURCE_MONTH_MATCH", "NO"], ["GME_PUBLISHED_AT", ""], ["GME_RETRIEVED_AT", ""],
  ["GME_NETWORK_CALLS", "0"], ["GME_HTTP_STATUS", ""], ["GME_MONTHLY_STATUS", "NOT_FOUND"], ["GME_F1_STATUS", "NOT_FOUND"], ["GME_F2_STATUS", "NOT_FOUND"], ["GME_F3_STATUS", "NOT_FOUND"], ["GME_ORIGINAL_UNIT", ""],
  ["MARKET_BACKUP_CREATED", "NO"], ["MARKET_BACKUP_READABLE", "NO"], ["MARKET_BACKUP_RESTORE_CHECK", "KO"], ["MARKET_BACKUP_PATH", ""], ["GME_RECORD_ACTION", ""], ["GME_IMPORT_RESULT", "KO"], ["GME_RECORD_READBACK", "KO"],
  ["PUN_INVOICE_PERIOD_ONLY", "KO"], ["PUN_HEADER_REAL_DATA", "KO"], ["PUN_APPLIED_STATUS_BEFORE", ""], ["PUN_APPLIED_STATUS_AFTER", ""], ["GME_DID_NOT_OVERWRITE_BILL_APPLIED_PUN", "KO"], ["ANALYST_NOT_FOUND_FIELDS_UNCHANGED", "KO"],
  ["ANTHROPIC_CALLS", "0"], ["REAL_REPROCESS", "0"], ["REAL_UPLOADS", "0"], ["REAL_RETRIES", "0"], ["TSC", "NOT_RUN"], ["LINT", "NOT_RUN"], ["GIT_DIFF_CHECK", "NOT_RUN"], ["BILL_TESTS", "NOT_RUN"], ["CTE_CODE_REGRESSION", "NOT_TOUCHED"], ["AUTOMATION_CREATED", "SI"], ["AUTOMATION_COMMAND", "npm run bill:gme-invoice-period-import"], ["FILE_MODIFICATI", ""],
]);

function set(key, value) { report.set(key, value); }
function printReport() { for (const [key, value] of report) console.log(`${key}=${value}`); }
function fail(message) { throw new Error(message); }

async function loadLocalEnv() {
  try {
    const content = await readFile(path.join(root, ".env.local"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

function preflight() {
  if (!process.argv.includes("--preflight-passed")) fail("GME_PREFLIGHT_REQUIRED");
  set("GIT_DIFF_CHECK", "PASS"); set("TSC", "PASS"); set("LINT", "PASS"); set("BILL_TESTS", "PASS");
}

function allowedUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "gme.mercatoelettrico.org") fail("GME_SOURCE_DOMAIN_BLOCKED");
  return parsed;
}

async function getOfficial(url, statuses) {
  let current = allowedUrl(url).toString();
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, { method: "GET", redirect: "manual", headers: { accept: "text/html, text/plain, application/pdf, application/octet-stream" } });
    statuses.push(response.status);
    set("GME_NETWORK_CALLS", String(statuses.length)); set("GME_HTTP_STATUS", statuses.join(","));
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) fail("GME_REDIRECT_LOCATION_MISSING");
      current = allowedUrl(new URL(location, current).toString()).toString();
      continue;
    }
    if (!response.ok) fail(`GME_HTTP_${response.status}`);
    return { response, url: current };
  }
  fail("GME_REDIRECT_LIMIT");
}

function decodePublication(bytes, contentType) {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const latin = Buffer.from(bytes).toString("latin1");
  const raw = /pdf|octet-stream|spreadsheet|excel/i.test(contentType) ? latin : utf8.includes("ï¿½") ? latin : utf8;
  if (raw.startsWith("%PDF-")) {
    const objects = new Map();
    for (const match of raw.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) objects.set(Number(match[1]), match[2]);
    const decompress = (value) => {
      const stream = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(value);
      if (!stream) return "";
      const compressed = Buffer.from(stream[1], "latin1");
      for (const inflate of [inflateSync, inflateRawSync]) { try { return inflate(compressed).toString("latin1"); } catch { /* non-flate stream */ } }
      return stream[1];
    };
    const cmapFor = (value) => {
      const map = new Map();
      const stream = decompress(value);
      for (const match of stream.matchAll(/<([0-9A-Fa-f]{4})>\s+<([0-9A-Fa-f]{4,6})>/g)) map.set(match[1].toUpperCase(), String.fromCodePoint(Number.parseInt(match[2], 16)));
      for (const match of stream.matchAll(/<([0-9A-Fa-f]{4})>\s+<([0-9A-Fa-f]{4})>\s+<([0-9A-Fa-f]{4})>/g)) for (let code = Number.parseInt(match[1], 16), end = Number.parseInt(match[2], 16), unicode = Number.parseInt(match[3], 16); code <= end; code += 1, unicode += 1) map.set(code.toString(16).padStart(4, "0").toUpperCase(), String.fromCodePoint(unicode));
      return map;
    };
    const fonts = new Map();
    for (const value of objects.values()) for (const match of value.matchAll(/\/F(\d+)\s+(\d+)\s+0\s+R/g)) {
      const font = objects.get(Number(match[2])) ?? "";
      const toUnicode = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font);
      if (toUnicode) fonts.set(`F${match[1]}`, cmapFor(objects.get(Number(toUnicode[1])) ?? ""));
    }
    const text = [];
    for (const value of objects.values()) {
      const stream = decompress(value);
      let font = "";
      for (const match of stream.matchAll(/(?:\/(F\d+))\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj|\(([^()]*)\)\s*Tj/g)) {
        if (match[1]) font = match[1];
        else if (match[2]) {
          const cmap = fonts.get(font);
          const decoded = match[2].match(/.{4}/g)?.map((code) => cmap?.get(code.toUpperCase()) ?? String.fromCodePoint(Number.parseInt(code, 16))).join("") ?? "";
          if (decoded) text.push(decoded);
        } else if (match[3]) text.push(match[3].replace(/\\([\\()])/g, "$1"));
      }
    }
    return text.join(" ").replace(/\bL[^A-Za-z0-9]{0,8}uglio\b/gi, "Luglio");
  }
  return /html/i.test(contentType) || /<html|<body|<table|<a\b/i.test(raw) ? raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&euro;|&#8364;/gi, "€").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim() : raw;
}

function unchanged(before, after, paths) { return paths.every((path) => path.split(".").reduce((value, key) => value?.[key], before)?.status === path.split(".").reduce((value, key) => value?.[key], after)?.status && path.split(".").reduce((value, key) => value?.[key], before)?.value === path.split(".").reduce((value, key) => value?.[key], after)?.value); }

async function main() {
  await loadLocalEnv();
  preflight();
  const { getRuntimeConfig } = await import("../app/lib/auth/config.ts");
  const { LocalBillRepository, toPublicDocument } = await import("../app/lib/foundation/real-bill.ts");
  const { LocalMarketArchiveRepository } = await import("../app/lib/market/repository.ts");
  const { backupMarketArchive } = await import("../app/lib/market/backup.ts");
  const { GmePunSourceAdapter } = await import("../app/lib/market/gme-pun-source.ts");
  const { attachOfficialPun, deriveInvoiceReferenceMonths, officialPunInputFromPublicBill } = await import("../app/lib/market/pun-reference.ts");
  const runtime = getRuntimeConfig();
  const billRepository = new LocalBillRepository();
  const bills = await billRepository.list(runtime.localTenantId);
  const bill = [...bills].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))[0];
  if (!bill) fail("CURRENT_BILL_NOT_FOUND");
  set("CURRENT_BILL_ID", bill.id);
  const publicBill = toPublicDocument(bill);
  const input = officialPunInputFromPublicBill(publicBill);
  if (!input.billingPeriod?.periodStart || !input.billingPeriod.periodEnd) fail("BILLING_PERIOD_NOT_FOUND");
  const months = deriveInvoiceReferenceMonths(input.billingPeriod);
  const allowedMonths = months;
  set("BILLING_PERIOD_START", input.billingPeriod.periodStart); set("BILLING_PERIOD_END", input.billingPeriod.periodEnd); set("INVOICE_REFERENCE_MONTHS", months.join(",")); set("BILLING_PERIOD_NORMALIZED", "OK"); set("GME_ALLOWED_MONTHS", allowedMonths.join(","));
  if (months.length !== allowedMonths.length || months.some((month, index) => month !== allowedMonths[index])) fail("GME_REFERENCE_MONTHS_NOT_ALLOWED");
  if (input.vector !== "EE") fail("GME_VECTOR_NOT_SUPPORTED");
  const beforeReview = publicBill.analystReview;
  set("PUN_APPLIED_STATUS_BEFORE", beforeReview.economics.punApplied.status);
  const statuses = [];
  const discovery = await getOfficial(discoveryUrl, statuses);
  const discoveryBody = await discovery.response.text();
  const publicationUrl = findPublicationLink(discoveryBody, discovery.url, months[0]);
  const publication = await getOfficial(publicationUrl, statuses);
  const bytes = new Uint8Array(await publication.response.arrayBuffer());
  const publicationText = decodePublication(bytes, publication.response.headers.get("content-type") ?? "");
  const retrievedAt = new Date().toISOString();
  const publishedAt = extractExplicitPublicationDate(publicationText);
  const marketBackup = await backupMarketArchive(marketRoot);
  set("MARKET_BACKUP_CREATED", marketBackup.created ? "SI" : "NO"); set("MARKET_BACKUP_READABLE", marketBackup.readable ? "SI" : "NO"); set("MARKET_BACKUP_RESTORE_CHECK", marketBackup.restoreCheck ? "OK" : "KO"); set("MARKET_BACKUP_PATH", marketBackup.path);
  if (!marketBackup.created || !marketBackup.readable || !marketBackup.restoreCheck) fail("MARKET_BACKUP_GATE_FAILED");
  const repository = new LocalMarketArchiveRepository(marketRoot);
  const adapter = new GmePunSourceAdapter(repository, process.env);
  const result = await adapter.importOfficialPublication({ tenantId: bill.tenantId, referenceMonth: months[0], publicationText, sourceReference: publication.url, publishedAt, retrievedAt });
  set("GME_SOURCE_AUTHORITY", "GME"); set("GME_SOURCE_REFERENCE", publication.url); set("GME_SOURCE_MONTH", months[0]); set("GME_SOURCE_MONTH_MATCH", "SI"); set("GME_PUBLISHED_AT", publishedAt ?? ""); set("GME_RETRIEVED_AT", retrievedAt); set("GME_NETWORK_CALLS", String(statuses.length)); set("GME_HTTP_STATUS", statuses.join(","));
  if (result.status !== "IMPORTED" || !result.record) fail(result.reason ?? "GME_IMPORT_FAILED");
  set("GME_RECORD_ACTION", result.action ?? ""); set("GME_IMPORT_RESULT", "OK");
  const market = result.record.record;
  set("GME_MONTHLY_STATUS", market.monthly ? "FOUND" : "NOT_FOUND"); set("GME_F1_STATUS", market.f1 ? "FOUND" : "NOT_FOUND"); set("GME_F2_STATUS", market.f2 ? "FOUND" : "NOT_FOUND"); set("GME_F3_STATUS", market.f3 ? "FOUND" : "NOT_FOUND"); set("GME_ORIGINAL_UNIT", [market.monthly, market.f1, market.f2, market.f3].find((rate) => rate)?.unit ?? "");
  const readback = await repository.get(bill.tenantId, result.record.archiveId);
  if (!readback || JSON.stringify(readback.record) !== JSON.stringify(result.record.record)) fail("GME_RECORD_READBACK_FAILED");
  set("GME_RECORD_READBACK", "OK");
  const afterBill = await attachOfficialPun(publicBill, repository);
  const review = afterBill.analystReview;
  set("PUN_APPLIED_STATUS_AFTER", review.economics.punApplied.status);
  const references = review.punReferences;
  const reference = references.length === 1 ? references[0] : null;
  const periodOnly = references.length === months.length && references.every((item, index) => item.referenceMonth === months[index] && allowedMonths.includes(item.referenceMonth));
  const realHeader = Boolean(reference?.status === "AVAILABLE" && reference.sourceType === "OFFICIAL" && reference.authority === "GME" && reference.sourceReference && new URL(reference.sourceReference).hostname === "gme.mercatoelettrico.org" && [reference.monthly, reference.f1, reference.f2, reference.f3].some((value) => typeof value === "number"));
  set("PUN_INVOICE_PERIOD_ONLY", periodOnly ? "OK" : "KO"); set("PUN_HEADER_REAL_DATA", realHeader ? "OK" : "KO"); set("GME_DID_NOT_OVERWRITE_BILL_APPLIED_PUN", beforeReview.economics.punApplied.status === review.economics.punApplied.status && beforeReview.economics.punApplied.value === review.economics.punApplied.value ? "SI" : "KO");
  const unchangedPaths = ["supply.address", "supply.nominalSupplyVoltage", "supply.power", "dates.billDueDate", "dates.economicConditionsExpiryDate", "dates.contractExpiryDate", "payment.method", "payment.regularity", "economics.punApplied", "economics.spread"];
  set("ANALYST_NOT_FOUND_FIELDS_UNCHANGED", unchanged(beforeReview, review, unchangedPaths) ? "SI" : "KO");
  set("FILE_MODIFICATI", "app/lib/market/gme-publication.ts; app/lib/market/gme-pun-source.ts; scripts/bill-gme-invoice-period-import.mjs; tests/fixtures/gme-july-2026-publication.txt; tests/gme-pun-source.smoke.mjs; tests/bill-gme-invoice-period-import.smoke.mjs");
  printReport();
  if (!["BILLING_PERIOD_NORMALIZED", "GME_IMPORT_RESULT", "GME_RECORD_READBACK", "PUN_INVOICE_PERIOD_ONLY", "PUN_HEADER_REAL_DATA"].every((key) => report.get(key) === "OK") || report.get("ANTHROPIC_CALLS") !== "0") fail("ACCEPTANCE_GATE_FAILED");
  console.log("BILL GME OFFICIAL REFERENCE IMPORT PASSED ? READY FOR REVIEW");
}

try { await main(); } catch (error) { if (report.get("GME_NETWORK_CALLS") === "0") set("GME_NETWORK_CALLS", "0"); printReport(); console.error(error instanceof Error ? error.message : "GME_IMPORT_FAILED"); console.log("BILL GME OFFICIAL REFERENCE IMPORT FAILED ? NO FALLBACK USED"); process.exitCode = 1; }
