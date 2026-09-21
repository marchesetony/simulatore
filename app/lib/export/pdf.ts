// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertProposalSnapshot } from "../proposal/service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { canonical } from "../proposal/integrity.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertProposalOutputSize, safeProposalFilename } from "./serialization.ts";
import type { ProposalCanonicalSnapshot } from "../proposal/types";
import type { ProposalExportDocument } from "./types";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 42;
const RIGHT = 553;
const TOP = 785;
const BOTTOM = 48;
const DARK = "0.10 0.14 0.19";
const MUTED = "0.31 0.36 0.41";
const ACCENT = "0.05 0.36 0.47";
const RULE = "0.78 0.81 0.83";

type PdfPage = { readonly commands: string[]; cursor: number };

function pdfText(value: unknown): string {
  const replacements: Record<string, number> = {
    "€": 0x80, "à": 0xe0, "è": 0xe8, "é": 0xe9, "ì": 0xec, "ò": 0xf2, "ù": 0xf9,
    "À": 0xc0, "È": 0xc8, "É": 0xc9, "Ì": 0xcc, "Ò": 0xd2, "Ù": 0xd9,
    "°": 0xb0, "²": 0xb2, "³": 0xb3,
  };
  const source = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  const bytes: number[] = [];
  for (const character of source) {
    const code = replacements[character] ?? character.charCodeAt(0);
    bytes.push(code <= 0xff ? code : 0x3f);
  }
  return String.fromCharCode(...bytes).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function literal(value: unknown): string { return `(${pdfText(value)})`; }

function compact(value: unknown): string { return canonical(value).replace(/[\r\n]+/g, " "); }

function money(value: { readonly amount: number; readonly currency: string } | null): string {
  return value === null ? "Unavailable" : `${value.amount.toFixed(2)} ${value.currency}`;
}

function wrap(value: unknown, maxChars: number): string[] {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (line) { lines.push(line); line = ""; }
      for (let offset = 0; offset < word.length; offset += maxChars) lines.push(word.slice(offset, offset + maxChars));
      continue;
    }
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

class PdfComposer {
  readonly pages: PdfPage[] = [];

  constructor() { this.newPage(); }

  private newPage(): PdfPage {
    const page: PdfPage = { commands: [], cursor: TOP };
    this.pages.push(page);
    page.commands.push("q", `${DARK} rg`, `${LEFT} ${PAGE_HEIGHT - 40} ${RIGHT - LEFT} 8 re f`, "Q");
    return page;
  }

  private current(): PdfPage { return this.pages[this.pages.length - 1]; }

  private ensure(height: number): PdfPage {
    if (this.current().cursor - height < BOTTOM) return this.newPage();
    return this.current();
  }

  private text(value: unknown, options: { readonly x?: number; readonly size?: number; readonly font?: "F1" | "F2"; readonly color?: string; readonly maxChars?: number; readonly lineHeight?: number } = {}): void {
    const size = options.size ?? 9;
    const x = options.x ?? LEFT;
    const lineHeight = options.lineHeight ?? Math.ceil(size * 1.35);
    const lines = wrap(value, options.maxChars ?? Math.max(24, Math.floor((RIGHT - x) / (size * 0.52))));
    for (const line of lines) {
      this.ensure(lineHeight);
      const page = this.current();
      page.commands.push(`BT /${options.font ?? "F1"} ${size} Tf ${options.color ?? DARK} rg 1 0 0 1 ${x} ${page.cursor} Tm ${literal(line)} Tj ET`);
      page.cursor -= lineHeight;
    }
  }

  title(value: string): void {
    this.ensure(42);
    this.text(value, { size: 23, font: "F2", color: DARK, maxChars: 42, lineHeight: 29 });
    this.text("Server-side commercial proposal", { size: 10, color: MUTED, lineHeight: 15 });
    this.rule(10);
  }

  section(value: string): void {
    this.ensure(34);
    this.current().cursor -= 8;
    this.text(value.toUpperCase(), { size: 10, font: "F2", color: ACCENT, maxChars: 70, lineHeight: 14 });
    this.rule(5);
  }

  keyValue(label: string, value: unknown): void {
    const valueText = String(value ?? "Unavailable");
    const lines = wrap(valueText, 62);
    this.ensure(Math.max(16, lines.length * 13));
    this.text(`${label}:`, { size: 8, font: "F2", color: MUTED, maxChars: 24, lineHeight: 13 });
    const page = this.current();
    page.cursor += 13;
    for (const line of lines) {
      this.text(line, { x: 174, size: 9, color: DARK, maxChars: 56, lineHeight: 13 });
    }
  }

  paragraph(value: unknown): void { this.text(value, { size: 9, color: DARK, maxChars: 96, lineHeight: 13 }); }

  bulletList(values: readonly string[]): void {
    if (values.length === 0) { this.paragraph("None"); return; }
    for (const value of values) this.text(`- ${value}`, { x: LEFT + 8, size: 9, color: DARK, maxChars: 88, lineHeight: 13 });
  }

  row(label: string, value: unknown): void {
    this.ensure(18);
    const page = this.current();
    page.commands.push(`${RULE} RG 0.5 w ${LEFT} ${page.cursor - 5} m ${RIGHT} ${page.cursor - 5} l S`);
    this.keyValue(label, value);
  }

  private rule(gap: number): void {
    const page = this.current();
    page.cursor -= gap;
    page.commands.push(`${RULE} RG 0.6 w ${LEFT} ${page.cursor} m ${RIGHT} ${page.cursor} l S`);
    page.cursor -= 8;
  }

  footer(): void {
    for (let index = 0; index < this.pages.length; index += 1) {
      const page = this.pages[index];
      page.commands.push(`${RULE} RG 0.5 w ${LEFT} 34 m ${RIGHT} 34 l S`);
      page.commands.push(`BT /F1 7 Tf ${MUTED} rg 1 0 0 1 ${LEFT} 22 Tm ${literal("Commercial proposal - source data and calculations are provided for review")} Tj ET`);
      page.commands.push(`BT /F1 7 Tf ${MUTED} rg 1 0 0 1 505 22 Tm ${literal(`Page ${index + 1} of ${this.pages.length}`)} Tj ET`);
    }
  }
}

function renderProposal(proposal: ProposalCanonicalSnapshot): PdfComposer {
  const pdf = new PdfComposer();
  pdf.title("Commercial proposal");
  pdf.keyValue("Proposal", proposal.proposalId);
  pdf.keyValue("Issued", proposal.generatedAt.slice(0, 10));
  pdf.keyValue("Vector / tax treatment", `${proposal.vector} / ${proposal.taxTreatment}`);

  pdf.section("Customer and supply");
  pdf.keyValue("Customer", `${proposal.customer.customerId} (${proposal.customer.category})${proposal.customer.displayName ? ` - ${proposal.customer.displayName}` : ""}`);
  pdf.keyValue("Supply", `${proposal.supply.supplyId}${proposal.supply.pod ? ` - POD ${proposal.supply.pod}` : ""}${proposal.supply.pdr ? ` - PDR ${proposal.supply.pdr}` : ""}${proposal.supply.voltageLevel ? ` - ${proposal.supply.voltageLevel}` : ""}`);
  pdf.keyValue("Simulation period", `${proposal.simulationPeriod.periodStart} to ${proposal.simulationPeriod.periodEnd}`);
  pdf.keyValue("Consumption", compact(proposal.normalizedConsumption));

  pdf.section("Selected offer");
  pdf.keyValue("Supplier / offer", `${proposal.selectedOffer.supplier} / ${proposal.selectedOffer.offerCode}`);
  pdf.keyValue("CTE", `${proposal.cte.cteId} version ${proposal.cte.version}`);
  pdf.keyValue("Archive / version ID", `${proposal.cte.archiveId} / ${proposal.cte.versionId}`);
  pdf.keyValue("Offer validity", `${proposal.offerValidity.periodStart} to ${proposal.offerValidity.periodEnd}`);

  pdf.section("Commercial summary");
  pdf.keyValue("Commercial total", money(proposal.commercialCost));
  pdf.keyValue("Comparison total", `${money(proposal.comparisonCost)} (${proposal.comparisonCostBasis})`);
  pdf.keyValue("Cost scope", `${proposal.costScope}; regulated: ${proposal.regulatedComponentsIncluded.join(", ") || "None"}`);
  pdf.keyValue("Unit cost", `${proposal.unitCost.amount} ${proposal.unitCost.currency} per ${proposal.unitCost.unit}`);
  pdf.keyValue("Baseline / savings", `${money(proposal.baseline)} / ${money(proposal.savings)}`);
  pdf.keyValue("Selected result", `${proposal.selectedResult.calculationId}; rank ${proposal.selectedResult.rankingPosition ?? "-"}; ${proposal.selectedResult.tieGroup ?? "no tie"}`);

  pdf.section("Calculated components");
  for (const component of proposal.components) {
    pdf.row(`${component.category} / ${component.sign}`, `${component.label} - ${money(component.amount)}; formula ${component.formulaId}`);
    pdf.keyValue("Formula inputs", compact(component.formulaInputs));
  }

  if (proposal.contractualPassThrough) {
    pdf.section("Contractual pass-through");
    pdf.keyValue("Completeness", `${proposal.contractualPassThrough.completeness}; BTA6 net-of-tax complete: ${proposal.contractualPassThrough.bta6NetOfTaxComplete}`);
    for (const state of proposal.contractualPassThrough.states) pdf.row(state.kind, `${state.state}; ${state.effectiveFrom} to ${state.effectiveTo}`);
  }

  pdf.section("Sources and audit");
  pdf.keyValue("Source bill", proposal.sourceBill ? `${proposal.sourceBill.billId} version ${proposal.sourceBill.version}` : "Not supplied");
  pdf.keyValue("Market records", proposal.marketData.length === 0 ? "None" : proposal.marketData.map((market) => `${market.vector} ${market.index} ${market.month} ${market.recordId} v${market.version}`).join("; "));
  pdf.keyValue("Calculation fingerprint", proposal.calculationFingerprint);
  pdf.keyValue("Proposal fingerprint", proposal.proposalFingerprint);
  pdf.keyValue("Rounding policy", proposal.roundingPolicy);

  pdf.section("Exclusions and review notes");
  pdf.keyValue("Not calculated", proposal.notCalculated.join("; ") || "None");
  pdf.keyValue("Unavailable information", proposal.unavailableInformation.join("; ") || "None");
  pdf.keyValue("Excluded offers", proposal.exclusions.length === 0 ? "None" : proposal.exclusions.map((item) => `${item.code}: ${item.message}`).join("; "));
  pdf.keyValue("Warnings", proposal.warnings.join("; ") || "None");
  pdf.keyValue("Notes", proposal.notes.join("; ") || "None");

  pdf.section("Disclaimer");
  pdf.paragraph(proposal.disclaimer);
  pdf.footer();
  return pdf;
}

function pdfBytes(pages: readonly PdfPage[]): Uint8Array {
  const objects: Array<Buffer | null> = [null];
  const add = (body: Buffer | string | null): number => { objects.push(body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1")); return objects.length - 1; };
  const catalogId = add(null);
  const pagesId = add(null);
  const regularFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const boldFontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds = pages.map(() => add(null));
  const contentIds = pages.map(() => add(null));
  objects[catalogId] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "latin1");
  objects[pagesId] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`, "latin1");
  pages.forEach((page, index) => {
    const stream = Buffer.from(`${page.commands.join("\n")}\n`, "latin1");
    objects[contentIds[index]] = Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("endstream", "latin1")]);
    objects[pageIds[index]] = Buffer.from(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`, "latin1");
  });
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xff\xff\xff\xff\n", "latin1")];
  const offsets: number[] = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = chunks.reduce((total, chunk) => total + chunk.length, 0);
    chunks.push(Buffer.from(`${index} 0 obj\n`, "latin1"), objects[index] as Buffer, Buffer.from("\nendobj\n", "latin1"));
  }
  const xrefOffset = chunks.reduce((total, chunk) => total + chunk.length, 0);
  chunks.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "latin1"));
  return new Uint8Array(Buffer.concat(chunks));
}

export function exportPdf(proposal: unknown, tenantId: string): ProposalExportDocument {
  const validated = assertProposalSnapshot(proposal, tenantId);
  const body = pdfBytes(renderProposal(validated).pages);
  assertProposalOutputSize(body);
  return { format: "PDF", contentType: "application/pdf", filename: safeProposalFilename(validated, "PDF"), body };
}
