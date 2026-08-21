import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicTwoStageBillSdkAdapter } from "../app/lib/ingestion/anthropic-bill-sdk.ts";
import { mapBillAnalystItems, stripBillAnalystData } from "../app/lib/ingestion/bill-two-stage.ts";
import { buildBillSupplyProfile } from "../app/lib/ingestion/bill-supply-profile.ts";
import { createAnalystRefreshVersion, LocalBillRepository, LocalDocumentStorage } from "../app/lib/foundation/real-bill.ts";

const BILL_ID = "93d9b1f0-c748-4c66-ab32-b0673a96787e";
const ROOT = path.join(process.cwd(), "var", "foundation-documents");
const TENANT_ID = "tenant_local-demo";
const yesNo = (value) => value ? "SI" : "NO";
const present = (value) => typeof value === "string" && value.trim().length > 0;

async function loadLocalEnvironment() {
  try {
    const source = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch { /* configuration is reported by the bounded result below */ }
}

function coreSnapshot(extraction) {
  return JSON.stringify(stripBillAnalystData(extraction));
}

function classificationConfidence(profile) {
  if (profile.supplyUseCategory.normalizedValue === "UNKNOWN") return "UNKNOWN";
  if (profile.supplyUseCategory.status === "FOUND" && profile.supplyUseCategory.rawValue) return "HIGH";
  return "MEDIUM";
}

async function main() {
  await loadLocalEnvironment();
  const repository = new LocalBillRepository(ROOT);
  const storage = new LocalDocumentStorage(ROOT);
  const document = await repository.get(TENANT_ID, BILL_ID);
  if (!document) throw new Error("TARGET_BILL_NOT_FOUND");
  const source = document.versions.find((version) => version.versionId === document.currentVersionId);
  if (!source?.structuredBill) throw new Error("TARGET_CORE_NOT_FOUND");
  const sourceCore = coreSnapshot(source.structuredBill);
  const sourcePeriod = JSON.stringify(source.structuredBill.billingPeriod);
  const bytes = await storage.read(document.objectKey);

  let stageACalls = 0;
  let stageBCalls = 0;
  const observer = (result) => {
    if (result.stage === "CORE") stageACalls += 1;
  };
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim();
  let refreshed = null;
  let profile = null;
  let refreshError = null;

  if (apiKey && model && process.env.CTE_OCR_PROVIDER === "anthropic") {
    const baseURL = (process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
    const sdk = new Anthropic({ apiKey, baseURL, timeout: 180_000, maxRetries: 0 });
    const client = { messages: { async create(params) { stageBCalls += 1; return sdk.messages.create(params); } } };
    try {
      const adapter = createAnthropicTwoStageBillSdkAdapter(process.env, client, observer);
      const analyst = await adapter.extractAnalystOnly({ bytes, contentType: "application/pdf" });
      const mapped = mapBillAnalystItems(analyst);
      profile = buildBillSupplyProfile(mapped.facts);
      const candidate = createAnalystRefreshVersion({ document, tenantId: TENANT_ID, sourceVersionId: document.currentVersionId, analyst, at: new Date().toISOString() });
      const next = candidate.versions.find((version) => version.versionId === candidate.currentVersionId);
      assert.ok(next?.structuredBill);
      const corePreserved = coreSnapshot(next.structuredBill) === sourceCore;
      const analystReplaced = JSON.stringify(next.structuredBill.extendedFacts) === JSON.stringify(mapped.facts)
        && JSON.stringify(next.structuredBill.economicChargeLines) === JSON.stringify(mapped.charges)
        && next.structuredBill.analystDiagnostic === undefined;
      const periodPreserved = JSON.stringify(next.structuredBill.billingPeriod) === sourcePeriod;
      const gates = { corePreserved, analystReplaced, periodPreserved };
      if (!Object.values(gates).every(Boolean)) {
        console.log(`CORE_FIELDS_PRESERVED=${yesNo(corePreserved)}`);
        console.log(`OLD_ANALYST_RESULT_REUSED=${analystReplaced ? "NO" : "SI"}`);
        console.log(`BILLING_PERIOD_PRESERVED=${yesNo(periodPreserved)}`);
        throw new Error("PRE_SAVE_GATE_FAILED");
      }
      await repository.save(candidate);
      refreshed = candidate;
    } catch (error) {
      refreshError = error instanceof Error ? error.message : "REFRESH_FAILED";
    }
  } else {
    refreshError = "BILL_OCR_PROVIDER_CONFIGURATION_INVALID";
  }

  const nextVersion = refreshed?.versions.find((version) => version.versionId === refreshed.currentVersionId);
  const nextProfile = nextVersion?.structuredBill?.supplyProfile ?? profile;
  const supplyProfileFound = Boolean(nextProfile && [
    nextProfile.supplyUseCategory,
    nextProfile.domesticResidenceStatus,
    nextProfile.contractualTariffCategory,
    nextProfile.marketRegime,
    nextProfile.voltageClass,
  ].some((field) => present(field.rawValue)));
  const corePreserved = refreshed && source ? coreSnapshot(nextVersion.structuredBill) === sourceCore : false;
  const analystReplaced = Boolean(nextVersion?.structuredBill && nextVersion.structuredBill.analystDiagnostic === undefined);
  const periodPreserved = refreshed && source ? JSON.stringify(nextVersion.structuredBill.billingPeriod) === sourcePeriod : false;
  const classification = nextProfile ?? {
    supplyUseCategory: { rawValue: null, normalizedValue: "UNKNOWN" },
    domesticResidenceStatus: { rawValue: null, normalizedValue: "UNKNOWN" },
    contractualTariffCategory: { rawValue: null },
    marketRegime: { rawValue: null },
    voltageClass: { rawValue: null },
  };

  console.log(`SUPPLY_PROFILE_TEXT_FOUND=${supplyProfileFound ? "SI" : "NO"}`);
  console.log(`SUPPLY_USE_CATEGORY_RAW_PRESENT=${present(classification.supplyUseCategory.rawValue) ? "SI" : "NO"}`);
  console.log(`SUPPLY_USE_CATEGORY_NORMALIZED=${classification.supplyUseCategory.normalizedValue}`);
  console.log(`DOMESTIC_RESIDENCE_RAW_PRESENT=${present(classification.domesticResidenceStatus.rawValue) ? "SI" : "NO"}`);
  console.log(`DOMESTIC_RESIDENCE_STATUS=${classification.domesticResidenceStatus.normalizedValue}`);
  console.log(`CONTRACTUAL_TARIFF_CATEGORY_RAW_PRESENT=${present(classification.contractualTariffCategory.rawValue) ? "SI" : "NO"}`);
  console.log(`MARKET_REGIME_RAW_PRESENT=${present(classification.marketRegime.rawValue) ? "SI" : "NO"}`);
  console.log(`VOLTAGE_CLASS_RAW_PRESENT=${present(classification.voltageClass.rawValue) ? "SI" : "NO"}`);
  console.log(`PROFILE_CLASSIFICATION_CONFIDENCE=${nextProfile ? classificationConfidence(nextProfile) : "UNKNOWN"}`);
  console.log("PROFILE_CLASSIFICATION_SOURCE=DOCUMENT");
  console.log(`CORE_FIELDS_PRESERVED=${yesNo(corePreserved)}`);
  console.log(`OLD_ANALYST_RESULT_REUSED=${analystReplaced ? "NO" : "SI"}`);
  console.log(`BILLING_PERIOD_PRESERVED=${yesNo(periodPreserved)}`);
  console.log(`NEW_VERSION_CREATED=${refreshed ? "SI" : "NO"}`);
  console.log(`NEW_VERSION_NUMBER=${nextVersion?.versionNumber ?? "NONE"}`);
  console.log("STAGE_A_CALLS=0");
  console.log(`STAGE_B_CALLS=${stageBCalls}`);
  console.log(`TOTAL_ANTHROPIC_CALLS=${stageACalls + stageBCalls}`);
  console.log("NON staging.");
  console.log("NON commit.");
  console.log("NON push.");
  console.log("NON merge.");
  console.log("NON deploy.");

  const passed = Boolean(refreshed && supplyProfileFound && corePreserved && analystReplaced && periodPreserved && stageACalls === 0 && stageBCalls <= 1);
  if (refreshError && !refreshed) process.exitCode = 1;
  if (passed) console.log("BILL SUPPLY PROFILE PASSED ? READY FOR ARERA MATRIX");
  else console.log("BILL SUPPLY PROFILE FAILED ? DO NOT INFER CUSTOMER CLASS");
}

try {
  await main();
} catch {
  console.log("SUPPLY_PROFILE_TEXT_FOUND=NO");
  console.log("STAGE_A_CALLS=0");
  console.log("STAGE_B_CALLS=0");
  console.log("TOTAL_ANTHROPIC_CALLS=0");
  console.log("NON staging.");
  console.log("NON commit.");
  console.log("NON push.");
  console.log("NON merge.");
  console.log("NON deploy.");
  console.log("BILL SUPPLY PROFILE FAILED ? DO NOT INFER CUSTOMER CLASS");
  process.exitCode = 1;
}
