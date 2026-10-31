// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { pdfBytes, pdfText, type PdfImage, type PdfPage } from "./pdf.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { jpegSize } from "../company/profile.ts";
import type { CompanyProfile } from "../company/profile";
import type { ProposalPresentation } from "../proposal/presentation";
import type { ProposalCanonicalSnapshot } from "../proposal/types";

/**
 * Tony (31/10): "l'offerta deve essere formulata come una bolletta come lo scontrino elettrico, con logo dell'azienda dati
 * aziendali percentuale e importo di risparmio annuale e mensile, oltre al nome della cte utilizzata e a uno specchietto che
 * paragona l'offerta alla bolletta che è stata simulata" — "in lingua italiana".
 * One A4 proposal laid out like a bill: company header with logo, customer and offer boxes, the savings, the scontrino
 * (bill against offer, voice by voice) and the comparison box.
 */
const W = 595;
const H = 842;
const L = 36;
const R = 559;
const BOTTOM = 56;
const INK = "0.10 0.16 0.26";
const MUTED = "0.40 0.45 0.53";
const TEAL = "0.03 0.49 0.46";
const TEAL_SOFT = "0.89 0.96 0.95";
const RED = "0.66 0.20 0.20";
const RED_SOFT = "0.99 0.93 0.93";
const LINE = "0.86 0.89 0.93";
const PANEL = "0.96 0.97 0.98";
const NAVY = "0.10 0.22 0.37";

// Helvetica widths (1/1000 em) for the characters a proposal prints; others take an average.
const NARROW = new Set([..." ,.;:'!|iIjlft()[]"]);
function charWidth(character: string, bold: boolean): number {
  if (/[0-9]/.test(character) || character === "€" || character === "$") return 556;
  if (NARROW.has(character)) return character === " " || character === "," || character === "." ? 278 : 300;
  if (character === "%") return 889;
  if (character === "-" || character === "−") return 333;
  if (character === "+") return 584;
  if (/[mwMW]/.test(character)) return bold ? 890 : 833;
  if (/[A-Z]/.test(character)) return bold ? 722 : 667;
  return bold ? 611 : 556;
}
function textWidth(value: string, size: number, bold = false): number { let total = 0; for (const character of value) total += charWidth(character, bold); return total * size / 1000; }

const EURO = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
const PERCENT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
function euro(value: number | null): string { return value === null ? "—" : `${EURO.format(value)} €`; }
function signed(value: number | null): string { return value === null ? "—" : Math.abs(value) < 0.005 ? "=" : `${value > 0 ? "+" : "-"}${EURO.format(Math.abs(value))} €`; }
function italianDate(value: string | null): string { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : "non indicata"; }

function wrap(value: string, width: number, size: number, bold = false): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, bold) <= width || !line) line = next; else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.flatMap((item) => {
    if (textWidth(item, size, bold) <= width) return [item];
    const pieces: string[] = []; let piece = "";
    for (const character of item) { if (textWidth(piece + character, size, bold) > width && piece) { pieces.push(piece); piece = character; } else piece += character; }
    return piece ? [...pieces, piece] : pieces;
  });
}

class Sheet {
  readonly pages: PdfPage[] = [];
  y = H - 36;
  private readonly header: (sheet: Sheet, first: boolean) => void;
  constructor(header: (sheet: Sheet, first: boolean) => void) { this.header = header; this.page(true); }
  private page(first: boolean): void { this.pages.push({ commands: [], cursor: H }); this.y = H - 36; this.header(this, first); }
  get cmd(): string[] { return this.pages[this.pages.length - 1].commands; }
  need(height: number): void { if (this.y - height < BOTTOM) this.page(false); }
  text(value: string, x: number, y: number, size: number, options: { readonly bold?: boolean; readonly color?: string; readonly align?: "left" | "right" | "center" } = {}): void {
    const width = textWidth(value, size, options.bold);
    const left = options.align === "right" ? x - width : options.align === "center" ? x - width / 2 : x;
    this.cmd.push(`BT /${options.bold ? "F2" : "F1"} ${size} Tf ${options.color ?? INK} rg 1 0 0 1 ${left.toFixed(2)} ${y.toFixed(2)} Tm (${pdfText(value)}) Tj ET`);
  }
  rect(x: number, y: number, width: number, height: number, fill: string, stroke?: string): void {
    this.cmd.push(`q ${fill} rg ${stroke ? `${stroke} RG 0.6 w ` : ""}${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${stroke ? "B" : "f"} Q`);
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, width = 0.6): void { this.cmd.push(`q ${color} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`); }
  image(name: string, x: number, y: number, width: number, height: number): void { this.cmd.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q`); }
  paragraph(value: string, x: number, width: number, size: number, options: { readonly bold?: boolean; readonly color?: string; readonly lineHeight?: number } = {}): void {
    const lineHeight = options.lineHeight ?? size * 1.4;
    for (const line of wrap(value, width, size, options.bold)) { this.need(lineHeight); this.text(line, x, this.y - size, size, options); this.y -= lineHeight; }
  }
  section(title: string): void {
    this.need(40);
    this.y -= 14;
    this.text(title.toUpperCase(), L, this.y - 10, 9, { bold: true, color: TEAL });
    this.y -= 16;
    this.line(L, this.y, R, this.y, TEAL, 0.8);
    this.y -= 6;
  }
}

function companyLines(profile: CompanyProfile | null): string[] {
  if (!profile) return [];
  return [profile.address, [profile.vatNumber ? `P. IVA ${profile.vatNumber}` : "", profile.phone ? `Tel. ${profile.phone}` : ""].filter(Boolean).join(" · "), [profile.email, profile.website].filter(Boolean).join(" · ")].filter(Boolean);
}

function box(sheet: Sheet, x: number, top: number, width: number, title: string, lines: readonly (readonly [string, string])[]): number {
  const labelWidth = 70;
  const rows = lines.map(([label, value]) => ({ label, value: wrap(value || "—", width - labelWidth - 20, 8.5) }));
  const height = 26 + rows.reduce((total, row) => total + row.value.length * 11.5 + 2, 0) + 6;
  sheet.rect(x, top - height, width, height, PANEL, LINE);
  sheet.text(title.toUpperCase(), x + 10, top - 15, 7.5, { bold: true, color: TEAL });
  let y = top - 30;
  for (const row of rows) {
    sheet.text(row.label, x + 10, y, 7.5, { color: MUTED });
    row.value.forEach((line, index) => sheet.text(line, x + 10 + labelWidth, y - index * 11.5, 8.5, { bold: index === 0 && row.label === "Nome CTE" }));
    y -= row.value.length * 11.5 + 2;
  }
  return height;
}

export function renderReceiptProposal(proposal: ProposalCanonicalSnapshot, presentation: ProposalPresentation, profile: CompanyProfile | null): Uint8Array {
  const images: PdfImage[] = [];
  const logoBytes = profile?.logo ? new Uint8Array(Buffer.from(profile.logo.slice(profile.logo.indexOf(",") + 1), "base64")) : null;
  const logoSize = logoBytes ? jpegSize(logoBytes) : null;
  if (logoBytes && logoSize) images.push({ name: "Logo", jpeg: logoBytes, ...logoSize });
  const companyName = profile?.name || "";
  const issued = italianDate(proposal.generatedAt.slice(0, 10));

  const sheet = new Sheet((page, first) => {
    if (!first) {
      // Later pages: a slim band with the company and the proposal number.
      page.rect(0, H - 6, W, 6, NAVY);
      page.text(companyName || "Proposta commerciale", L, H - 28, 9, { bold: true });
      page.text(`Proposta del ${issued}`, R, H - 28, 8, { color: MUTED, align: "right" });
      page.line(L, H - 36, R, H - 36);
      page.y = H - 48;
      return;
    }
    page.rect(0, H - 8, W, 8, NAVY);
    let textLeft = L;
    if (logoSize) {
      const scale = Math.min(110 / logoSize.width, 52 / logoSize.height);
      const width = logoSize.width * scale; const height = logoSize.height * scale;
      page.image("Logo", L, H - 30 - height, width, height);
      textLeft = L + width + 14;
    }
    if (companyName) page.text(companyName, textLeft, H - 40, 13, { bold: true });
    companyLines(profile).forEach((line, index) => page.text(line, textLeft, H - 54 - index * 10.5, 7.5, { color: MUTED }));
    page.text("PROPOSTA COMMERCIALE", R, H - 38, 14, { bold: true, color: NAVY, align: "right" });
    page.text(`Emessa il ${issued}`, R, H - 52, 8, { color: MUTED, align: "right" });
    page.text(`Offerta valida fino al ${italianDate(presentation.validUntil)}`, R, H - 63, 8, { bold: true, color: TEAL, align: "right" });
    page.line(L, H - 96, R, H - 96, LINE, 0.8);
    page.y = H - 106;
  });

  // Customer and offer boxes, side by side.
  const half = (R - L - 12) / 2;
  const top = sheet.y;
  const left = box(sheet, L, top, half, "Cliente e fornitura", [
    ["Cliente", presentation.customerName || proposal.customer.displayName || ""],
    ["Fornitura", presentation.supplyLabel],
    ["Periodo", presentation.periodLabel],
    ["Consumi", presentation.consumptionLabel],
    ["Fornitore attuale", [presentation.billSupplier, presentation.billOfferName].filter(Boolean).join(" · ")],
  ]);
  const right = box(sheet, L + half + 12, top, half, "Offerta proposta", [
    ["Fornitore", presentation.offerSupplier || proposal.selectedOffer.supplier],
    ["Nome CTE", presentation.offerName],
    ["Codice", presentation.offerCode || proposal.selectedOffer.offerCode],
    ["Validità", `fino al ${italianDate(presentation.validUntil)}`],
  ]);
  sheet.y = top - Math.max(left, right) - 12;

  // Savings: annual, monthly and on the simulated bill, in euro and percent.
  const annual = presentation.annualSaving;
  const annualPercent = annual !== null && presentation.annualCurrent ? annual / presentation.annualCurrent * 100 : null;
  const saving = presentation.savings;
  const positive = (annual ?? saving ?? 0) >= 0;
  const savingsHeight = 74;
  sheet.need(savingsHeight + 10);
  const sTop = sheet.y;
  sheet.rect(L, sTop - savingsHeight, R - L, savingsHeight, positive ? TEAL_SOFT : RED_SOFT);
  const tone = positive ? TEAL : RED;
  const third = (R - L) / 3;
  const cell = (index: number, title: string, value: string, sub: string) => {
    const x = L + third * index + 14;
    sheet.text(title.toUpperCase(), x, sTop - 18, 7.5, { bold: true, color: tone });
    sheet.text(value, x, sTop - 42, 19, { bold: true, color: tone });
    sheet.text(sub, x, sTop - 58, 7.5, { color: MUTED });
    if (index) sheet.line(L + third * index, sTop - savingsHeight + 10, L + third * index, sTop - 10, positive ? "0.70 0.86 0.84" : "0.92 0.75 0.75");
  };
  if (presentation.sameOffer) {
    sheet.text("STESSA OFFERTA DELLA BOLLETTA", L + 14, sTop - 18, 7.5, { bold: true, color: tone });
    sheet.text(`${saving !== null && saving >= 0 ? "La bolletta addebita" : "La bolletta addebita meno di"} ${euro(saving === null ? null : Math.abs(saving))}${saving !== null && saving >= 0 ? " in più di quanto prevede la CTE" : " rispetto alla CTE"}`, L + 14, sTop - 42, 12, { bold: true, color: tone });
    sheet.text("Verifica voce per voce nello scontrino qui sotto.", L + 14, sTop - 58, 7.5, { color: MUTED });
  } else {
    const word = (value: number | null) => value !== null && value < 0 ? "Costo in più" : "Risparmio";
    cell(0, `${word(annual)} annuo`, annual === null ? "—" : euro(Math.abs(annual)), annualPercent === null ? presentation.annualBasisLabel || "su 12 mesi" : `${PERCENT.format(Math.abs(annualPercent))}% della spesa annua`);
    cell(1, `${word(annual)} mensile`, annual === null ? "—" : euro(Math.abs(annual) / 12), "media su 12 mesi");
    cell(2, `${word(saving)} sulla bolletta`, saving === null ? "—" : euro(Math.abs(saving)), presentation.savingsPercent === null ? "sulla bolletta simulata" : `${PERCENT.format(Math.abs(presentation.savingsPercent))}% della bolletta simulata`);
  }
  sheet.y = sTop - savingsHeight - 4;
  if (presentation.annualBasisLabel && !presentation.sameOffer) { sheet.y -= 4; sheet.paragraph(presentation.annualBasisLabel, L, R - L, 7.5, { color: MUTED }); }

  // Scontrino: every voice of the bill against the offer.
  sheet.section("Scontrino dell'energia: bolletta attuale e nuova offerta");
  const cols = { label: L + 6, current: L + 330, offer: L + 420, diff: R - 6 };
  const headerRow = () => {
    sheet.need(22);
    sheet.rect(L, sheet.y - 18, R - L, 18, NAVY);
    sheet.text("Voce", cols.label, sheet.y - 12.5, 7.5, { bold: true, color: "1 1 1" });
    sheet.text("Bolletta attuale", cols.current, sheet.y - 12.5, 7.5, { bold: true, color: "1 1 1", align: "right" });
    sheet.text("Nuova offerta", cols.offer, sheet.y - 12.5, 7.5, { bold: true, color: "1 1 1", align: "right" });
    sheet.text("Differenza", cols.diff, sheet.y - 12.5, 7.5, { bold: true, color: "1 1 1", align: "right" });
    sheet.y -= 18;
  };
  headerRow();
  for (const row of presentation.rows) {
    const size = row.detail ? 7.5 : 8.5;
    const labelLines = wrap(row.label + (row.note ? ` (${row.note})` : ""), cols.current - cols.label - 70, size, !row.detail);
    const height = Math.max(15, labelLines.length * (size + 3) + 5);
    const pagesBefore = sheet.pages.length;
    sheet.need(height);
    if (sheet.pages.length !== pagesBefore) headerRow();
    if (!row.detail) sheet.rect(L, sheet.y - height, R - L, height, PANEL);
    labelLines.forEach((line, index) => sheet.text(line, cols.label + (row.detail ? 10 : 0), sheet.y - size - 3 - index * (size + 3), size, { bold: !row.detail, color: row.detail ? MUTED : INK }));
    const baseline = sheet.y - size - 3;
    sheet.text(euro(row.current), cols.current, baseline, size, { bold: !row.detail, align: "right" });
    sheet.text(euro(row.offer), cols.offer, baseline, size, { bold: !row.detail, align: "right" });
    const changed = row.difference !== null && Math.abs(row.difference) >= 0.005;
    sheet.text(signed(row.difference), cols.diff, baseline, size, { bold: !row.detail, align: "right", color: !changed ? MUTED : row.difference! < 0 ? TEAL : RED });
    sheet.y -= height;
    sheet.line(L, sheet.y, R, sheet.y);
  }
  sheet.need(24);
  sheet.rect(L, sheet.y - 22, R - L, 22, TEAL_SOFT);
  const totalLabel = presentation.taxesIncluded ? "Totale (imposte comprese)" : "Totale imposte escluse";
  sheet.text(totalLabel, cols.label, sheet.y - 15, 9.5, { bold: true });
  sheet.text(euro(presentation.currentTotal), cols.current, sheet.y - 15, 9.5, { bold: true, align: "right" });
  sheet.text(euro(presentation.offerTotal), cols.offer, sheet.y - 15, 9.5, { bold: true, align: "right", color: TEAL });
  sheet.text(signed(saving === null ? null : -saving), cols.diff, sheet.y - 15, 9.5, { bold: true, align: "right", color: saving !== null && saving >= 0 ? TEAL : RED });
  sheet.y -= 26;
  if (presentation.excluded.length) sheet.paragraph(`Escluse dal confronto: ${presentation.excluded.map((item) => `${item.label} ${euro(item.amount)}`).join("; ")}.`, L, R - L, 7.5, { color: MUTED });

  // Specchietto: the offer against the simulated bill.
  if (presentation.comparison.length) {
    sheet.section("Confronto tra l'offerta e la bolletta simulata");
    const c1 = L + 6; const c2 = L + 175; const c3 = L + 355; const w2 = c3 - c2 - 10; const w3 = R - c3 - 6;
    sheet.need(22);
    sheet.rect(L, sheet.y - 18, R - L, 18, NAVY);
    sheet.text("Caratteristica", c1, sheet.y - 12.5, 7.5, { bold: true, color: "1 1 1" });
    sheet.text("Bolletta attuale", c2, sheet.y - 12.5, 7.5, { bold: true, color: "1 1 1" });
    sheet.text("Offerta proposta", c3, sheet.y - 12.5, 7.5, { bold: true, color: "1 1 1" });
    sheet.y -= 18;
    for (const row of presentation.comparison) {
      const label = wrap(row.label, c2 - c1 - 10, 8, true); const bill = wrap(row.bill || "—", w2, 8); const offer = wrap(row.offer || "—", w3, 8, true);
      const height = Math.max(label.length, bill.length, offer.length) * 11 + 7;
      sheet.need(height);
      label.forEach((line, index) => sheet.text(line, c1, sheet.y - 11 - index * 11, 8, { bold: true }));
      bill.forEach((line, index) => sheet.text(line, c2, sheet.y - 11 - index * 11, 8, { color: MUTED }));
      offer.forEach((line, index) => sheet.text(line, c3, sheet.y - 11 - index * 11, 8, { bold: true, color: TEAL }));
      sheet.y -= height;
      sheet.line(L, sheet.y, R, sheet.y);
    }
  }

  sheet.section("Note");
  sheet.paragraph(`Simulazione sugli stessi consumi e sullo stesso periodo della bolletta, con le voci di spesa della delibera ARERA 386/2025. Tariffa per l'uso della rete, oneri generali di sistema e accise non dipendono dal fornitore. Importi ${presentation.taxesIncluded ? "comprensivi di IVA e accise" : "al netto di IVA e imposte"}. Prezzi dell'energia dai dati ufficiali GME/ARERA del periodo. L'offerta va sottoscritta entro il ${italianDate(presentation.validUntil)}.`, L, R - L, 7.5, { color: MUTED });

  // Footer on every page.
  sheet.pages.forEach((page, index) => {
    page.commands.push(`q ${LINE} RG 0.5 w ${L} 40 m ${R} 40 l S Q`);
    page.commands.push(`BT /F1 7 Tf ${MUTED} rg 1 0 0 1 ${L} 28 Tm (${pdfText([companyName, "Proposta commerciale", issued].filter(Boolean).join(" · "))}) Tj ET`);
    const label = `Pagina ${index + 1} di ${sheet.pages.length}`;
    page.commands.push(`BT /F1 7 Tf ${MUTED} rg 1 0 0 1 ${(R - textWidth(label, 7)).toFixed(2)} 28 Tm (${pdfText(label)}) Tj ET`);
  });
  return pdfBytes(sheet.pages, images);
}
