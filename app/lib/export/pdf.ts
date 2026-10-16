import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { assertProposalSnapshot } from "../proposal/service.ts";
import type { ProposalCanonicalSnapshot } from "../proposal/types";
import type { TenantBranding } from "../branding/types";
import type { ProposalExportInput } from "./types";

export interface ProposalPdfDocument {
  readonly format: "PDF";
  readonly contentType: "application/pdf";
  readonly filename: string;
  readonly body: Uint8Array;
}

type Component = ProposalCanonicalSnapshot["components"][number];
type Quota = "ENERGY" | "FIXED" | "OTHER";
interface ReceiptRow { readonly label: string; readonly quantity: string; readonly unitPrice: string; readonly amount: number }

const A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 48;
const INK = rgb(0.1, 0.16, 0.26);
const MUTED = rgb(0.4, 0.45, 0.52);
const LINE = rgb(0.84, 0.87, 0.91);
const ACCENT = rgb(0.03, 0.49, 0.46);
const ACCENT_SOFT = rgb(0.89, 0.96, 0.95);
const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");

const euroFormat = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormat = (digits: number) => new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: digits });
function euro(value: number): string { return euroFormat.format(value).replace(/ /g, " "); }
function num(value: number, digits = 2): string { return numberFormat(digits).format(value).replace(/ /g, " "); }
function date(value: string): string { const [year, month, day] = value.slice(0, 10).split("-"); return `${day}/${month}/${year}`; }
/** Standard PDF fonts only encode WinAnsi; anything else is replaced so untrusted text can never break generation. */
function safe(value: unknown): string { return String(value ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, "\"").replace(/[–—]/g, "-").replace(/[^ -~ -ÿ€]/g, "?"); }

function quotaOf(component: Component): Quota {
  if (component.category === "ENERGY") return "ENERGY";
  const unit = component.formulaInputs.feeUnit;
  if (unit === "EUR_PER_KWH" || unit === "EUR_PER_SMC") return "ENERGY";
  if (unit === "EUR_PER_MONTH" || unit === "EUR_PER_YEAR") return "FIXED";
  return "OTHER";
}
function signed(component: Component): number { return component.sign === "DISCOUNT" ? -component.amount.amount : component.amount.amount; }
function totalOf(components: readonly Component[]): number { return Math.round(components.reduce((sum, item) => sum + signed(item), 0) * 100) / 100; }

function consumption(proposal: ProposalCanonicalSnapshot): { readonly quantity: number; readonly unit: "kWh" | "Smc"; readonly detail: string } {
  const value = proposal.normalizedConsumption;
  if ("f1" in value) { const quantity = value.f1 + value.f2 + value.f3; return { quantity, unit: "kWh", detail: `${num(quantity)} kWh (F1 ${num(value.f1)} - F2 ${num(value.f2)} - F3 ${num(value.f3)})` }; }
  const coefficient = value.correctionCoefficient?.required ? value.correctionCoefficient.value : null;
  return { quantity: coefficient ? value.smc * coefficient : value.smc, unit: "Smc", detail: `${num(value.smc)} Smc${coefficient ? ` (coefficiente C ${num(coefficient, 6)})` : ""}` };
}

function receiptRows(proposal: ProposalCanonicalSnapshot): readonly ReceiptRow[] {
  const used = consumption(proposal);
  const groups: Record<Quota, Component[]> = { ENERGY: [], FIXED: [], OTHER: [] };
  proposal.components.forEach((component) => groups[quotaOf(component)].push(component));
  const rows: ReceiptRow[] = [];
  const energy = totalOf(groups.ENERGY);
  rows.push({ label: "Quota per consumi", quantity: `${num(used.quantity)} ${used.unit}`, unitPrice: used.quantity > 0 ? `${num(energy / used.quantity, 6)} €/${used.unit}` : "-", amount: energy });
  if (groups.FIXED.length) {
    const fixed = totalOf(groups.FIXED);
    const months = groups.FIXED.reduce((max, item) => Math.max(max, Number(item.formulaInputs.basisQuantity ?? 0) * (item.formulaInputs.feeUnit === "EUR_PER_YEAR" ? 12 : 1)), 0);
    rows.push({ label: "Quota fissa", quantity: months > 0 ? `${num(months)} mesi` : "-", unitPrice: months > 0 ? `${num(fixed / months, 4)} €/mese` : "-", amount: fixed });
  } else rows.push({ label: "Quota fissa", quantity: "-", unitPrice: "Non prevista dall'offerta", amount: 0 });
  if (proposal.vector === "EE") rows.push({ label: "Quota potenza", quantity: "-", unitPrice: "Non prevista dall'offerta", amount: 0 });
  if (groups.OTHER.length) rows.push({ label: "Altre partite", quantity: `${groups.OTHER.length} voci`, unitPrice: "-", amount: totalOf(groups.OTHER) });
  return rows;
}

function priceType(proposal: ProposalCanonicalSnapshot): string {
  const fixed = proposal.components.some((item) => item.componentId === "energy:fixed");
  if (fixed) return "Prezzo fisso";
  const index = proposal.vector === "EE" ? "PUN Index GME" : "PSV";
  return `Prezzo variabile indicizzato al ${index}`;
}

class Writer {
  page!: PDFPage;
  y = 0;
  pageNumber = 0;
  readonly doc: PDFDocument;
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly header: (writer: Writer) => void;
  constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont, header: (writer: Writer) => void) { this.doc = doc; this.regular = regular; this.bold = bold; this.header = header; }
  newPage(): void { this.page = this.doc.addPage([A4.width, A4.height]); this.pageNumber += 1; this.y = A4.height - MARGIN; this.header(this); }
  ensure(height: number): void { if (this.y - height < MARGIN + 30) this.newPage(); }
  text(value: string, x: number, size: number, options: { readonly font?: PDFFont; readonly color?: ReturnType<typeof rgb>; readonly align?: "left" | "right"; readonly width?: number } = {}): void {
    const font = options.font ?? this.regular; const text = safe(value);
    const drawX = options.align === "right" && options.width !== undefined ? x + options.width - font.widthOfTextAtSize(text, size) : x;
    this.page.drawText(text, { x: drawX, y: this.y, size, font, color: options.color ?? INK });
  }
  wrap(value: string, width: number, size: number, font = this.regular): string[] {
    const lines: string[] = []; let line = "";
    for (const word of safe(value).split(/\s+/).filter(Boolean)) { const next = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(next, size) <= width) line = next; else { if (line) lines.push(line); line = word; } }
    if (line) lines.push(line);
    return lines;
  }
  paragraph(value: string, size = 9, color = MUTED, width = A4.width - 2 * MARGIN): void {
    for (const line of this.wrap(value, width, size)) { this.ensure(size + 4); this.text(line, MARGIN, size, { color }); this.y -= size + 4; }
  }
  heading(value: string, number: string): void {
    this.ensure(40); this.y -= 8;
    this.page.drawRectangle({ x: MARGIN, y: this.y - 4, width: 18, height: 16, color: ACCENT });
    this.text(number, MARGIN + 3.5, 9, { font: this.bold, color: rgb(1, 1, 1) });
    this.text(value, MARGIN + 26, 13, { font: this.bold }); this.y -= 22;
  }
  rule(): void { this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4.width - MARGIN, y: this.y }, thickness: 0.6, color: LINE }); }
  pairs(items: readonly (readonly [string, string])[]): void {
    const column = (A4.width - 2 * MARGIN) / 2;
    for (let index = 0; index < items.length; index += 2) {
      const row = items.slice(index, index + 2);
      const heights = row.map(([, value]) => this.wrap(value, column - 12, 10, this.bold).length);
      const height = 14 + Math.max(...heights) * 13;
      this.ensure(height + 6);
      const top = this.y;
      row.forEach(([label, value], position) => {
        const x = MARGIN + position * column; this.y = top;
        this.text(label, x, 8, { color: MUTED }); this.y -= 13;
        this.wrap(value, column - 12, 10, this.bold).forEach((line) => { this.text(line, x, 10, { font: this.bold }); this.y -= 13; });
      });
      this.y = top - height - 4;
    }
  }
  table(headers: readonly string[], widths: readonly number[], rows: readonly (readonly string[])[], options: { readonly boldRows?: ReadonlySet<number>; readonly rightFrom?: number } = {}): void {
    const rightFrom = options.rightFrom ?? 1;
    const draw = (cells: readonly string[], font: PDFFont, size: number, color = INK) => {
      const lines = cells.map((cell, index) => this.wrap(cell, widths[index] - 8, size, font));
      const height = Math.max(...lines.map((item) => Math.max(item.length, 1))) * (size + 3) + 8;
      this.ensure(height);
      const top = this.y; let x = MARGIN;
      lines.forEach((cellLines, index) => { this.y = top - size - 2; cellLines.forEach((line) => { this.text(line, x + 4, size, { font, color, align: index >= rightFrom ? "right" : "left", width: widths[index] - 8 }); this.y -= size + 3; }); x += widths[index]; });
      this.y = top - height;
      this.page.drawLine({ start: { x: MARGIN, y: this.y + 2 }, end: { x: MARGIN + widths.reduce((a, b) => a + b, 0), y: this.y + 2 }, thickness: 0.5, color: LINE });
    };
    draw(headers, this.bold, 8, MUTED);
    rows.forEach((row, index) => draw(row, options.boldRows?.has(index) ? this.bold : this.regular, 9.5));
    this.y -= 6;
  }
}

async function embedLogo(doc: PDFDocument, branding: TenantBranding | null | undefined): Promise<PDFImage | null> {
  if (!branding?.logo) return null;
  const bytes = Buffer.from(branding.logo.dataBase64, "base64");
  try {
    if (branding.logo.contentType === "image/png") return await doc.embedPng(bytes);
    if (branding.logo.contentType === "image/jpeg") return await doc.embedJpg(bytes);
  } catch { return null; }
  return null;
}

export async function exportPdf(input: ProposalExportInput, tenantId: string, branding?: TenantBranding | null): Promise<ProposalPdfDocument> {
  const proposal = assertProposalSnapshot(input, tenantId) as ProposalCanonicalSnapshot;
  const doc = await PDFDocument.create();
  const sellerName = branding?.legalName ?? proposal.selectedOffer.supplier;
  doc.setTitle(safe(`Proposta commerciale ${sellerName}`)); doc.setAuthor(safe(sellerName)); doc.setSubject(safe(proposal.proposalId)); doc.setProducer("Simulatore bollette"); doc.setCreator("Simulatore bollette");
  doc.setCreationDate(FIXED_DATE); doc.setModificationDate(FIXED_DATE);
  const regular = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(doc, branding);
  const service = proposal.vector === "EE" ? "Energia elettrica" : "Gas naturale";

  const writer = new Writer(doc, regular, bold, (w) => {
    const top = A4.height - MARGIN; let textX = MARGIN;
    if (logo) { const scale = Math.min(110 / logo.width, 40 / logo.height); w.page.drawImage(logo, { x: MARGIN, y: top - 40 * 0.5 - logo.height * scale / 2 + 2, width: logo.width * scale, height: logo.height * scale }); textX = MARGIN + logo.width * scale + 12; }
    w.y = top - 12; w.text(sellerName, textX, 12, { font: bold });
    // Left column stops before the right-aligned labels so a long address wraps instead of overlapping them.
    const detailWidth = A4.width - MARGIN - 175 - textX;
    const details = [branding?.vatNumber ? `P.IVA ${branding.vatNumber}` : "", ...(branding?.address ? w.wrap(branding.address, detailWidth, 8) : [])].filter(Boolean).slice(0, 3);
    details.forEach((line, index) => { w.y = top - 25 - index * 10; w.text(line, textX, 8, { color: MUTED }); });
    w.y = top - 12; w.text("PROPOSTA COMMERCIALE", MARGIN, 9, { font: bold, color: ACCENT, align: "right", width: A4.width - 2 * MARGIN });
    w.y = top - 26; w.text(`${service} - mercato libero - pagina ${w.pageNumber}`, MARGIN, 8, { color: MUTED, align: "right", width: A4.width - 2 * MARGIN });
    w.y = top - 48; w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: A4.width - MARGIN, y: w.y }, thickness: 1.2, color: INK });
    w.page.drawText(safe(`Rif. ${proposal.proposalId} - simulazione del ${date(proposal.generatedAt)}`), { x: MARGIN, y: MARGIN - 18, size: 7, font: regular, color: MUTED });
    w.y -= 22;
  });
  writer.newPage();

  // 1. Frontespizio
  const used = consumption(proposal);
  writer.heading("Cliente e fornitura", "1");
  writer.pairs([
    ["Cliente", proposal.customer.displayName ?? proposal.customer.customerId],
    ["Tipologia cliente", proposal.customer.category === "RESIDENTIAL" ? "Domestico" : "Non domestico"],
    ["Servizio", `${service} - mercato libero`],
    [proposal.vector === "EE" ? "Punto di prelievo (POD)" : "Punto di riconsegna (PDR)", proposal.supply.pod ?? proposal.supply.pdr ?? proposal.supply.supplyId],
    ["Periodo simulato", `dal ${date(proposal.simulationPeriod.periodStart)} al ${date(proposal.simulationPeriod.periodEnd)}`],
    ["Consumo nel periodo", used.detail],
  ]);

  writer.heading("Sintesi del confronto", "2");
  const boxHeight = proposal.baseline ? 92 : 56;
  writer.ensure(boxHeight + 8);
  const boxTop = writer.y + 6;
  writer.page.drawRectangle({ x: MARGIN, y: boxTop - boxHeight, width: A4.width - 2 * MARGIN, height: boxHeight, color: ACCENT_SOFT, borderColor: ACCENT, borderWidth: 1 });
  const inner = A4.width - 2 * MARGIN - 32;
  writer.y = boxTop - 22; writer.text("Spesa per la vendita con l'offerta proposta", MARGIN + 16, 10); writer.text(euro(proposal.commercialCost.amount), MARGIN + 16, 13, { font: bold, align: "right", width: inner });
  if (proposal.baseline) {
    writer.y -= 22; writer.text("Spesa per la vendita nella bolletta attuale", MARGIN + 16, 10); writer.text(euro(proposal.baseline.amount), MARGIN + 16, 13, { font: bold, align: "right", width: inner });
    const savings = proposal.savings?.amount ?? 0; const share = proposal.baseline.amount > 0 ? ` (${num(savings / proposal.baseline.amount * 100, 1)}%)` : "";
    writer.y -= 26; writer.text(savings >= 0 ? "Risparmio nel periodo" : "Maggiore spesa nel periodo", MARGIN + 16, 11, { font: bold, color: ACCENT }); writer.text(`${euro(Math.abs(savings))}${share}`, MARGIN + 16, 15, { font: bold, color: ACCENT, align: "right", width: inner });
  } else { writer.y -= 20; writer.text("Costo della bolletta attuale non indicato: risparmio non calcolato.", MARGIN + 16, 9, { color: MUTED }); }
  writer.y = boxTop - boxHeight - 14;
  writer.paragraph(`Offerta valida dal ${date(proposal.offerValidity.periodStart)} al ${date(proposal.offerValidity.periodEnd)}. Il confronto riguarda la spesa per la vendita: la spesa per il trasporto e la gestione del contatore, gli oneri di sistema e le imposte sono fissati da ARERA e dalla legge, sono gli stessi con qualsiasi venditore e non cambiano passando a questa offerta.`);

  // 3. Scontrino dell'energia
  writer.heading("Scontrino dell'energia - offerta proposta", "3");
  const rows = receiptRows(proposal);
  const tableRows = rows.map((row) => [row.label, row.quantity, row.unitPrice, row.amount === 0 && row.unitPrice.startsWith("Non") ? "-" : euro(row.amount)]);
  tableRows.push(["Totale spesa per la vendita", "", "", euro(proposal.commercialCost.amount)]);
  if (proposal.baseline) tableRows.push(["Bolletta attuale, stessa voce", "", "", euro(proposal.baseline.amount)]);
  tableRows.push(["Trasporto, gestione contatore e oneri di sistema", "", "Regolati ARERA", "Invariati"]);
  tableRows.push(["Imposte e IVA", "", "Per legge", "Invariate"]);
  writer.table(["Voce", "Quantità", "Prezzo medio", "Importo"], [190, 90, 110, 109], tableRows, { boldRows: new Set([rows.length]) });
  writer.y -= 6;
  writer.paragraph("Lettura come nello scontrino della Bolletta 2.0: quantità × prezzo medio = importo. Il prezzo medio comprende tutti i corrispettivi della stessa quota, sconti inclusi.", 8);

  // 4. Box offerta
  writer.ensure(150); // keep the offer box on one page
  writer.heading("Box offerta", "4");
  const markets = proposal.marketData.map((market) => `${market.index} ${market.month}`).join(", ");
  writer.pairs([
    ["Venditore", proposal.selectedOffer.supplier],
    ["Codice offerta", `${proposal.selectedOffer.offerCode} (CTE ${proposal.cte.cteId}, versione ${proposal.cte.version})`],
    ["Tipo di prezzo", priceType(proposal)],
    ["Indice e periodo di riferimento", markets || "Non applicabile (prezzo fisso)"],
    ["Prezzo medio vendita", `${num(proposal.unitCost.amount, 6)} €/${used.unit}`],
    ["Validità offerta", `dal ${date(proposal.offerValidity.periodStart)} al ${date(proposal.offerValidity.periodEnd)}`],
  ]);

  // 5. Dettaglio
  writer.ensure(110); // never leave the heading and table header alone at the foot of a page
  writer.heading("Dettaglio dei corrispettivi", "5");
  writer.table(["Corrispettivo", "Calcolo", "Importo"], [230, 170, 99], proposal.components.map((component) => {
    const inputs = component.formulaInputs; const rate = inputs.feeRate ?? inputs.pricePerKwh ?? inputs.pricePerSmc;
    const basis = inputs.basisQuantity ?? (component.category === "ENERGY" ? used.quantity : undefined);
    const effectiveRate = rate ?? (component.category === "ENERGY" && used.quantity > 0 ? signed(component) / used.quantity : undefined);
    const calc = effectiveRate !== undefined && basis !== undefined ? `${num(Number(effectiveRate), 6)} × ${num(Number(basis), 3)}` : effectiveRate !== undefined ? `${num(Number(effectiveRate), 6)} €` : "-";
    return [`${component.label}${component.sign === "DISCOUNT" ? " (sconto)" : ""}`, calc, euro(signed(component))];
  }));
  if (proposal.notes.length) { writer.heading("Note", "6"); proposal.notes.forEach((note) => writer.paragraph(note, 9, INK)); }
  writer.ensure(60); writer.y -= 6; writer.rule(); writer.y -= 12;
  writer.paragraph(`Documento di simulazione, non è una bolletta. Struttura ispirata alla Bolletta 2.0 (delibera ARERA 315/2024/R/com). Importi IVA ${proposal.taxTreatment === "INCLUDED" ? "inclusa" : "esclusa"}, calcolati sui consumi del periodo indicato con le condizioni economiche della CTE approvata; i consumi futuri e, per le offerte indicizzate, l'andamento dell'indice possono modificare la spesa effettiva. Impronta di controllo ${proposal.proposalFingerprint.slice(0, 16)}.`, 7.5);

  const body = await doc.save({ useObjectStreams: false });
  const filename = `proposta-${proposal.proposalId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160) + ".pdf";
  return { format: "PDF", contentType: "application/pdf", filename, body };
}
