// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { canonical } from "../proposal/integrity.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertProposalSnapshot } from "../proposal/service.ts";
import type { ProposalCanonicalSnapshot } from "../proposal/types";
import type { ProposalExportDocument, ProposalExportInput } from "./types";

const CSV_COLUMNS = [
  "rowType", "proposalId", "tenantId", "vector", "customerId", "supplyId", "supplier", "offerCode", "cteId", "cteVersion",
  "simulationPeriodStart", "simulationPeriodEnd", "offerValidityStart", "offerValidityEnd", "consumptionUnit", "consumptionF1", "consumptionF2", "consumptionF3", "consumptionSmc",
  "commercialCost", "unitCost", "baseline", "savings", "componentId", "category", "label", "sign", "formulaId", "formulaInputs", "amount", "minorUnits", "currency", "taxTreatment", "calculationFingerprint", "proposalFingerprint", "rankingPosition", "tieGroup", "notes", "disclaimer",
  "sourceBillId", "sourceBillVersion", "cteVersionId", "marketReferences", "warnings", "excludedOffers", "notCalculated", "unavailableInformation",
] as const;

function safeFilename(proposal: ProposalCanonicalSnapshot, format: "JSON" | "CSV" | "HTML"): string {
  const base = `commercial-proposal-${proposal.proposalId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160);
  return `${base}.${format.toLowerCase()}`;
}
function outputSize(body: string): void { if (Buffer.byteLength(body, "utf8") > 524288) throw new Error("PROPOSAL_OUTPUT_TOO_LARGE"); }
function jsonValue(value: unknown): string { return canonical(value); }
function csvField(value: unknown): string {
  const valueText = value === undefined || value === null ? "" : typeof value === "string" ? value : jsonValue(value);
  return /[",\r\n]/.test(valueText) ? `"${valueText.replace(/"/g, '""')}"` : valueText;
}
function csvRow(values: readonly unknown[]): string { return values.map(csvField).join(","); }
function consumptionValues(proposal: ProposalCanonicalSnapshot): { readonly unit: string; readonly f1: string; readonly f2: string; readonly f3: string; readonly smc: string } {
  if ("f1" in proposal.normalizedConsumption) return { unit: proposal.normalizedConsumption.unit, f1: String(proposal.normalizedConsumption.f1), f2: String(proposal.normalizedConsumption.f2), f3: String(proposal.normalizedConsumption.f3), smc: "" };
  return { unit: proposal.normalizedConsumption.unit, f1: "", f2: "", f3: "", smc: String(proposal.normalizedConsumption.smc) };
}
function commonCsvValues(proposal: ProposalCanonicalSnapshot): readonly unknown[] {
  const consumption = consumptionValues(proposal);
  return [proposal.proposalId, proposal.tenantId, proposal.vector, proposal.customer.customerId, proposal.supply.supplyId, proposal.selectedOffer.supplier, proposal.selectedOffer.offerCode, proposal.cte.cteId, proposal.cte.version, proposal.simulationPeriod.periodStart, proposal.simulationPeriod.periodEnd, proposal.offerValidity.periodStart, proposal.offerValidity.periodEnd, consumption.unit, consumption.f1, consumption.f2, consumption.f3, consumption.smc, proposal.commercialCost.amount, proposal.unitCost.amount, proposal.baseline?.amount, proposal.savings?.amount, "", "", "", "", "", "", "", "EUR", proposal.taxTreatment, proposal.calculationFingerprint, proposal.proposalFingerprint, proposal.selectedResult.rankingPosition, proposal.selectedResult.tieGroup, proposal.notes.join(" "), proposal.disclaimer, proposal.sourceBill?.billId, proposal.sourceBill?.version, proposal.cte.versionId, proposal.marketData.map((market) => `${market.recordId}:${market.version}`).join(";"), proposal.warnings.join(" | "), proposal.exclusions.map((item) => `${item.code}:${item.message}`).join(" | "), proposal.notCalculated.join(" | "), proposal.unavailableInformation.join(" | ")];
}

export function exportJson(proposal: ProposalExportInput, tenantId: string): ProposalExportDocument {
  const validated = assertProposalSnapshot(proposal, tenantId);
  const body = `${canonical(validated)}\n`;
  outputSize(body);
  return { format: "JSON", contentType: "application/json; charset=utf-8", filename: safeFilename(validated, "JSON"), body };
}

export function exportCsv(proposal: ProposalExportInput, tenantId: string): ProposalExportDocument {
  const validated = assertProposalSnapshot(proposal, tenantId);
  const common = commonCsvValues(validated);
  const summary = ["SUMMARY", ...common];
  const componentRows = validated.components.map((component: ProposalCanonicalSnapshot["components"][number]) => [
    "COMPONENT", ...common.slice(0, 22), component.componentId, component.category, component.label, component.sign, component.formulaId,
    jsonValue(component.formulaInputs), component.amount.amount, component.amount.minorUnits, component.amount.currency, ...common.slice(31),
  ]);
  const body = `${csvRow(CSV_COLUMNS)}\r\n${csvRow(summary)}\r\n${componentRows.map(csvRow).join("\r\n")}\r\n`;
  outputSize(body);
  return { format: "CSV", contentType: "text/csv; charset=utf-8", filename: safeFilename(validated, "CSV"), body };
}

function escapeHtml(value: unknown): string { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function htmlMoney(value: { readonly amount: number; readonly currency: string } | null): string { return value ? `${escapeHtml(value.amount)} ${escapeHtml(value.currency)}` : "Unavailable"; }
function htmlList(values: readonly string[]): string { return values.length === 0 ? "<p>None</p>" : `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`; }

export function exportHtml(proposal: ProposalExportInput, tenantId: string): ProposalExportDocument {
  const validated = assertProposalSnapshot(proposal, tenantId);
  const componentRows = validated.components.map((component: ProposalCanonicalSnapshot["components"][number]) => `<tr><td>${escapeHtml(component.category)}</td><td>${escapeHtml(component.label)}</td><td>${escapeHtml(component.sign)}</td><td>${escapeHtml(component.amount.amount)} ${escapeHtml(component.amount.currency)}</td><td>${escapeHtml(component.formulaId)}</td><td><code>${escapeHtml(jsonValue(component.formulaInputs))}</code></td></tr>`).join("");
  const marketRows = validated.marketData.map((market: ProposalCanonicalSnapshot["marketData"][number]) => `${market.vector} ${market.index} ${market.month} version ${market.version}`);
  const exclusionRows = validated.exclusions.map((exclusion: ProposalCanonicalSnapshot["exclusions"][number]) => `${exclusion.code}: ${exclusion.message}`);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(validated.proposalId)}</title><style>body{font-family:Arial,sans-serif;line-height:1.4;margin:2rem;color:#17202a}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #9aa4ad;padding:.4rem;text-align:left;vertical-align:top}code{white-space:pre-wrap;word-break:break-word}.muted{color:#52606d}</style></head><body><article><header><h1>Commercial proposal</h1><p class="muted">Proposal ${escapeHtml(validated.proposalId)} - issued ${escapeHtml(validated.generatedAt.slice(0, 10))}</p></header><section><h2>Customer and supply</h2><p>Customer: ${escapeHtml(validated.customer.customerId)} (${escapeHtml(validated.customer.category)})${validated.customer.displayName ? ` - ${escapeHtml(validated.customer.displayName)}` : ""}</p><p>Supply: ${escapeHtml(validated.supply.supplyId)}${validated.supply.pod ? ` - POD ${escapeHtml(validated.supply.pod)}` : ""}${validated.supply.pdr ? ` - PDR ${escapeHtml(validated.supply.pdr)}` : ""}</p></section><section><h2>Selected offer</h2><p>Supplier: ${escapeHtml(validated.selectedOffer.supplier)} - Offer: ${escapeHtml(validated.selectedOffer.offerCode)} - CTE ${escapeHtml(validated.cte.cteId)} version ${escapeHtml(validated.cte.version)} (version ID ${escapeHtml(validated.cte.versionId)})</p><p>Validity: ${escapeHtml(validated.offerValidity.periodStart)} to ${escapeHtml(validated.offerValidity.periodEnd)}</p></section><section><h2>Calculated commercial components</h2><p>Total: <strong>${htmlMoney(validated.commercialCost)}</strong></p><p>Unit cost: ${escapeHtml(validated.unitCost.amount)} ${escapeHtml(validated.unitCost.currency)} per ${escapeHtml(validated.unitCost.unit)}</p><p>Baseline: ${htmlMoney(validated.baseline)} - Savings: ${htmlMoney(validated.savings)}</p><table><thead><tr><th>Category</th><th>Label</th><th>Sign</th><th>Amount</th><th>Formula</th><th>Inputs</th></tr></thead><tbody>${componentRows}</tbody></table></section><section><h2>Sources and audit</h2><p>Calculation fingerprint: <code>${escapeHtml(validated.calculationFingerprint)}</code></p><p>Proposal fingerprint: <code>${escapeHtml(validated.proposalFingerprint)}</code></p><p>Market records:</p>${htmlList(marketRows)}</section><section><h2>Excluded or not calculated charges</h2>${htmlList(validated.notCalculated)}${htmlList(exclusionRows)}</section><section><h2>Warnings</h2>${htmlList(validated.warnings)}</section><section><h2>Unavailable information</h2>${htmlList(validated.unavailableInformation)}</section><section><h2>Informational notes</h2>${htmlList(validated.notes)}</section><section><h2>Disclaimer</h2><p>${escapeHtml(validated.disclaimer)}</p></section></article></body></html>`;
  outputSize(body);
  return { format: "HTML", contentType: "text/html; charset=utf-8", filename: safeFilename(validated, "HTML"), body };
}
