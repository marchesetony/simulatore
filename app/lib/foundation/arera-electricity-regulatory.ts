import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { RegulatoryRepository } from "./regulatory-ports";
import type { RegulatoryCustomerScope, RegulatoryValueComponentCode, RegulatoryValueRecord, RegulatoryValueSourceType } from "./regulatory-types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { referenceDomainForComponent } from "./regulatory-domains.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { checksumFor } from "./regulatory-validation.ts";

export const ARERA_ALLOWED_HOSTS = new Set(["arera.it", "www.arera.it"]);
export const TERNA_ALLOWED_HOSTS = new Set(["terna.it", "www.terna.it", "dati.terna.it"]);
export const ARERA_575_PAGE = "https://www.arera.it/area-operatori/prezzi-e-tariffe/tariffe-trasmissione-distribuzione-e-misura-clienti-domestici";
export const ARERA_227_PAGE = "https://www.arera.it/atti-e-provvedimenti/dettaglio/26/227-26";
export const ARERA_SYSTEM_CHARGES_PAGE = "https://www.arera.it/area-operatori/prezzi-e-tariffe/oneri-generali-di-sistema-e-ulteriori-componenti";
export const ARERA_575_IDENTIFIER = "575/2025/R/eel";
export const ARERA_227_IDENTIFIER = "227/2026/R/com";
export const ARERA_588_IDENTIFIER = "588/2025/R/com";
export const ARERA_588_TABLES_URL = "https://www.arera.it/fileadmin/allegati/docs/25/588-2025-R-com-TABELLE.xlsx";
export const ARERA_227_PDF_URL = "https://www.arera.it/fileadmin/allegati/docs/26/227-2026-R-com.pdf";
export const ARERA_587_PAGE = "https://www.arera.it/atti-e-provvedimenti/dettaglio/25/587-25";
export const ARERA_587_PDF_URL = "https://www.arera.it/fileadmin/allegati/docs/25/587-2025-R-eel.pdf";
export const ARERA_587_IDENTIFIER = "587/2025/R/eel";

export interface AreraFetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly text: () => Promise<string>;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}
export type AreraFetcher = (input: string, init?: RequestInit) => Promise<AreraFetchResponse>;

export interface UnitNormalization {
  readonly value: number;
  readonly unit: string;
  readonly provenance: readonly string[];
}

const sourceHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const textHash = (text: string): string => sourceHash(new TextEncoder().encode(text));
const clean = (value: string): string => value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const stripTags = (value: string): string => clean(value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&euro;/gi, "€"));
const canonicalUnit = (value: string): string => clean(value).toUpperCase().replace(/€/g, "EUR").replace(/CENTESIMI DI EURO/g, "CENT_EUR").replace(/CENTESIMI DI EURO\//g, "CENT_EUR/").replace(/CENT\.? EUR/g, "CENT_EUR").replace(/\s+/g, "").replace(/\//g, "/").replace(/PUNTO(?:DIPRELIEVO)?/g, "POD").replace(/PUNTOPRELIEVO/g, "POD").replace(/KW\/ANNO/g, "KW/YEAR").replace(/POD\/ANNO/g, "POD/YEAR").replace(/KW\/MESE/g, "KW/MONTH").replace(/POD\/MESE/g, "POD/MONTH").replace(/KWH/g, "KWH");

export function isAllowedAreraUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ARERA_ALLOWED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function assertAllowedAreraUrl(value: string): void {
  if (!isAllowedAreraUrl(value)) throw new Error("ARERA_DOMAIN_NOT_ALLOWED");
}

export function isAllowedOfficialRegulatoryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (ARERA_ALLOWED_HOSTS.has(url.hostname.toLowerCase()) || TERNA_ALLOWED_HOSTS.has(url.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

export async function fetchOfficialAreraSource(url: string, fetcher: AreraFetcher = fetch as unknown as AreraFetcher): Promise<{ readonly url: string; readonly bytes: Uint8Array; readonly contentType: string }> {
  let current = url;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assertAllowedAreraUrl(current);
    const response = await fetcher(current, { redirect: "manual", headers: { Accept: "text/html,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv", "User-Agent": "BillRegulatoryAuditEngine/1.0 (official-source-import)", Referer: ARERA_227_PAGE } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("ARERA_REDIRECT_WITHOUT_LOCATION");
      current = new URL(location, current).toString();
      assertAllowedAreraUrl(current);
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`ARERA_HTTP_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { url: current, bytes, contentType: response.headers.get("content-type") ?? "" };
  }
  throw new Error("ARERA_REDIRECT_LIMIT");
}

const parseItalianNumber = (value: string): number => {
  const normalized = clean(value).replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error("ARERA_NUMBER_INVALID");
  return parsed;
};

type TableRow = readonly string[];
const tableRows = (html: string): readonly TableRow[] => [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1]))).filter((row) => row.length > 0);

const recordId = (identityKey: string): string => `arera_${createHash("sha256").update(identityKey).digest("hex").slice(0, 24)}`;
const scopeFor = (value: string | undefined): RegulatoryCustomerScope => {
  const scope = clean(value ?? "DOMESTIC_BT").toUpperCase().replace(/\s+/g, "_") as RegulatoryCustomerScope;
  if (!["DOMESTIC_BT", "DOMESTIC_RESIDENT_BT", "DOMESTIC_NON_RESIDENT_BT", "NON_DOMESTIC_BT", "ALL_ELECTRICITY"].includes(scope)) throw new Error("ARERA_CUSTOMER_SCOPE_INVALID");
  return scope;
};

const componentFor = (value: string): RegulatoryValueComponentCode => {
  const code = clean(value).toUpperCase().replace(/[ -]/g, "_");
  if (["ASOS", "ARIM", "UC3", "UC6", "S1_TOTAL", "S1_MEASURE", "S2_POWER", "S3_ENERGY_TRANSMISSION", "NETWORK_FIXED", "METERING_FIXED", "NETWORK_POWER", "NETWORK_ENERGY", "TRANSMISSION_ENERGY", "DISPATCHING", "DISPATCHING_TOTAL", "DISPATCHING_UPLIFT", "DISPATCHING_UPLIFT_ATT_MSDMB", "DISPATCHING_UPLIFT_ATT_DED", "DISPATCHING_UPLIFT_RUPL", "DISPATCHING_ESSENTIAL_UNITS", "DISPATCHING_ESSENTIAL_UNITS_ORDINARY", "DISPATCHING_ESSENTIAL_UNITS_REINTEGRATION", "DISPATCHING_TERNA_OPERATION", "DISPATCHING_EXTRAORDINARY_MODULATION", "DISPATCHING_WIND_COMPENSATION", "DISPATCHING_OTHER_ITEMS", "CAPACITY_MARKET", "CAPACITY_MARKET_PEAK", "CAPACITY_MARKET_OFF_PEAK"].includes(code)) return code as RegulatoryValueComponentCode;
  throw new Error("ARERA_COMPONENT_CODE_INVALID");
};

function unitBase(value: number, originalUnit: string): { readonly value: number; readonly unit: string; readonly provenance: readonly string[] } {
  const unit = canonicalUnit(originalUnit);
  if (unit === "EUR") return { value, unit, provenance: [] };
  if (unit === "EUR/KWH") return { value, unit, provenance: [] };
  if (unit === "EUR/MWH") return { value: value / 1000, unit: "EUR/KWH", provenance: ["MWH_TO_KWH_DIVIDE_1000"] };
  if (unit === "CENT_EUR/KWH") return { value: value / 100, unit: "EUR/KWH", provenance: ["CENT_EUR_TO_EUR_DIVIDE_100"] };
  if (unit === "EUR/KW/YEAR") return { value, unit, provenance: [] };
  if (unit === "CENT_EUR/KW/YEAR") return { value: value / 100, unit: "EUR/KW/YEAR", provenance: ["CENT_EUR_TO_EUR_DIVIDE_100"] };
  if (unit === "EUR/KW/MONTH") return { value: value * 12, unit: "EUR/KW/YEAR", provenance: ["MONTH_TO_YEAR_MULTIPLY_12"] };
  if (unit === "EUR/POD/YEAR") return { value, unit, provenance: [] };
  if (unit === "CENT_EUR/POD/YEAR") return { value: value / 100, unit: "EUR/POD/YEAR", provenance: ["CENT_EUR_TO_EUR_DIVIDE_100"] };
  if (unit === "EUR/POD/MONTH") return { value: value * 12, unit: "EUR/POD/YEAR", provenance: ["MONTH_TO_YEAR_MULTIPLY_12"] };
  if (unit === "CENT_EUR/POD/MONTH") return { value: value * 12 / 100, unit: "EUR/POD/YEAR", provenance: ["CENT_EUR_TO_EUR_DIVIDE_100", "MONTH_TO_YEAR_MULTIPLY_12"] };
  throw new Error(`REGULATORY_UNIT_UNSUPPORTED:${originalUnit}`);
}

export function normalizeRegulatoryUnit(value: number, originalUnit: string, targetUnit?: string): UnitNormalization {
  const base = unitBase(value, originalUnit);
  if (!targetUnit) return { ...base, unit: base.unit };
  const target = canonicalUnit(targetUnit);
  if (target === base.unit) return { ...base, unit: target };
  if (base.unit === "EUR/KW/YEAR" && target === "EUR/KW/MONTH") return { value: base.value / 12, unit: target, provenance: [...base.provenance, "YEAR_TO_MONTH_DIVIDE_12"] };
  if (base.unit === "EUR/POD/YEAR" && target === "EUR/POD/MONTH") return { value: base.value / 12, unit: target, provenance: [...base.provenance, "YEAR_TO_MONTH_DIVIDE_12"] };
  if (base.unit === "EUR/KWH" && target === "EUR/MWH") return { value: base.value * 1000, unit: target, provenance: [...base.provenance, "KWH_TO_MWH_MULTIPLY_1000"] };
  throw new Error(`REGULATORY_UNIT_INCOMPATIBLE:${originalUnit}:${targetUnit}`);
}

export function createRegulatoryValue(input: {
  readonly tenantId: string;
  readonly sourceType: RegulatoryValueSourceType;
  readonly sourceReference: string;
  readonly officialIdentifier: string;
  readonly publicationDate: string;
  readonly retrievedAt: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly componentCode: RegulatoryValueComponentCode;
  readonly customerScope?: string;
  readonly originalValue: number;
  readonly originalUnit: string;
  readonly applicationBasis: string;
  readonly sourceSha256: string;
  readonly conversionProvenance?: readonly string[];
  readonly carriedForwardFrom?: string | null;
  readonly confirmationSource?: string | null;
  readonly authority?: "ARERA" | "TERNA";
  readonly publishedBy?: "ARERA" | "TERNA";
  readonly calculatedBy?: "ARERA" | "TERNA";
  readonly officialName?: string;
  readonly contractPassThroughRequired?: boolean;
  readonly referenceDomain?: RegulatoryValueRecord["referenceDomain"];
}): RegulatoryValueRecord {
  if (!isAllowedOfficialRegulatoryUrl(input.sourceReference)) throw new Error("OFFICIAL_REGULATORY_DOMAIN_NOT_ALLOWED");
  const normalized = normalizeRegulatoryUnit(input.originalValue, input.originalUnit);
  const identityKey = [input.tenantId, input.officialIdentifier, input.componentCode, scopeFor(input.customerScope), input.effectiveFrom, normalized.unit].join("|");
  const base = {
    tenantId: input.tenantId, id: recordId(identityKey), identityKey, version: "1", parentVersionId: null,
    authority: input.authority ?? "ARERA", sourceType: input.sourceType, sourceReference: input.sourceReference, officialIdentifier: input.officialIdentifier,
    publishedBy: input.publishedBy ?? input.authority ?? "ARERA", calculatedBy: input.calculatedBy ?? input.authority ?? "ARERA", officialName: input.officialName ?? input.componentCode, contractPassThroughRequired: input.contractPassThroughRequired ?? false,
    publicationDate: input.publicationDate, retrievedAt: input.retrievedAt, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
    vector: "EE" as const, customerScope: scopeFor(input.customerScope), componentCode: input.componentCode, referenceDomain: input.referenceDomain ?? referenceDomainForComponent(input.componentCode) ?? undefined,
    originalValue: input.originalValue, originalUnit: canonicalUnit(input.originalUnit), normalizedValue: normalized.value, normalizedUnit: normalized.unit,
    applicationBasis: input.applicationBasis, sourceSha256: input.sourceSha256, approvalStatus: "IMPORTED" as const, reviewStatus: "NEEDS_REVIEW" as const,
    ...(input.carriedForwardFrom === undefined ? {} : { carriedForwardFrom: input.carriedForwardFrom }),
    ...(input.confirmationSource === undefined ? {} : { confirmationSource: input.confirmationSource }),
    conversionProvenance: [...normalized.provenance, ...(input.conversionProvenance ?? [])],
  };
  return { ...base, checksum: checksumFor(base) };
}

const createValue = createRegulatoryValue;

export type AreraInfrastructureImport = {
  readonly source: { readonly sourceReference: string; readonly officialIdentifier: string; readonly publicationDate: string; readonly retrievedAt: string; readonly sourceSha256: string };
  readonly records: readonly RegulatoryValueRecord[];
};

export function parseArera575DomesticInfrastructure(input: { readonly html: string; readonly sourceReference?: string; readonly publicationDate?: string; readonly retrievedAt: string; readonly sourceSha256?: string; readonly tenantId?: string }): AreraInfrastructureImport {
  const sourceReference = input.sourceReference ?? ARERA_575_PAGE;
  const publicationDate = input.publicationDate ?? "2025-12-30";
  const tenantId = input.tenantId ?? "tenant_local-demo";
  const rows = tableRows(input.html);
  const row = rows.find((cells) => cells[0] === "2026");
  if (!row || row.length < 5) throw new Error("ARERA_575_2026_ROW_MISSING");
  const values = row.slice(1, 5).map(parseItalianNumber);
  const sourceSha256 = input.sourceSha256 ?? textHash(input.html);
  const base = { tenantId, sourceType: "OFFICIAL_WEB_PAGE" as const, sourceReference, officialIdentifier: ARERA_575_IDENTIFIER, publicationDate, retrievedAt: input.retrievedAt, effectiveFrom: "2026-01-01", effectiveTo: "2027-01-01", customerScope: "DOMESTIC_BT", sourceSha256 };
  const records = [
    createValue({ ...base, componentCode: "S1_TOTAL", originalValue: values[0], originalUnit: "CENT_EUR/POD/YEAR", applicationBasis: "componente s1 - totale quota fissa per punto di prelievo per anno" }),
    createValue({ ...base, componentCode: "S1_MEASURE", originalValue: values[1], originalUnit: "CENT_EUR/POD/YEAR", applicationBasis: "componente s1 - di cui misura" }),
    createValue({ ...base, componentCode: "S2_POWER", originalValue: values[2], originalUnit: "CENT_EUR/KW/YEAR", applicationBasis: "componente s2 - quota potenza" }),
    createValue({ ...base, componentCode: "S3_ENERGY_TRANSMISSION", originalValue: values[3], originalUnit: "CENT_EUR/KWH", applicationBasis: "componente s3 - quota energia/trasmissione" }),
  ];
  return { source: { sourceReference, officialIdentifier: ARERA_575_IDENTIFIER, publicationDate, retrievedAt: input.retrievedAt, sourceSha256 }, records };
}

export type AreraAttachment = { readonly url: string; readonly extension: "XLS" | "XLSX" | "CSV" | "PDF" | "HTML"; readonly anchorText: string };
export function discoverAreraAttachments(html: string): readonly AreraAttachment[] {
  const results: AreraAttachment[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = new URL(match[1], ARERA_227_PAGE).toString();
    if (!isAllowedAreraUrl(url)) continue;
    const path = new URL(url).pathname.toLowerCase();
    const extension = path.endsWith(".xlsx") ? "XLSX" : path.endsWith(".xls") ? "XLS" : path.endsWith(".csv") ? "CSV" : path.endsWith(".pdf") ? "PDF" : path.endsWith(".html") || path.endsWith(".htm") ? "HTML" : null;
    if (extension) results.push({ url, extension, anchorText: stripTags(match[2]) });
  }
  return results;
}

type XlsxCell = { readonly value: string; readonly row: number; readonly column: string };

const littleEndian16 = (bytes: Uint8Array, offset: number): number => bytes[offset] | (bytes[offset + 1] << 8);
const littleEndian32 = (bytes: Uint8Array, offset: number): number => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

function zipEntry(bytes: Uint8Array, wantedName: string): Uint8Array {
  const decoder = new TextDecoder();
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (littleEndian32(bytes, index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error("ARERA_XLSX_ZIP_INVALID");
  const count = littleEndian16(bytes, end + 10);
  let cursor = littleEndian32(bytes, end + 16);
  for (let index = 0; index < count; index += 1) {
    if (littleEndian32(bytes, cursor) !== 0x02014b50) throw new Error("ARERA_XLSX_CENTRAL_DIRECTORY_INVALID");
    const method = littleEndian16(bytes, cursor + 10);
    const compressedSize = littleEndian32(bytes, cursor + 20);
    const nameLength = littleEndian16(bytes, cursor + 28);
    const extraLength = littleEndian16(bytes, cursor + 30);
    const commentLength = littleEndian16(bytes, cursor + 32);
    const localOffset = littleEndian32(bytes, cursor + 42);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (name === wantedName) {
      if (littleEndian32(bytes, localOffset) !== 0x04034b50) throw new Error("ARERA_XLSX_LOCAL_HEADER_INVALID");
      const localNameLength = littleEndian16(bytes, localOffset + 26);
      const localExtraLength = littleEndian16(bytes, localOffset + 28);
      const payload = bytes.slice(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize);
      if (method === 0) return payload;
      if (method === 8) return new Uint8Array(inflateRawSync(payload));
      throw new Error("ARERA_XLSX_COMPRESSION_UNSUPPORTED");
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ARERA_XLSX_ENTRY_MISSING:${wantedName}`);
}

const xmlDecode = (value: string): string => value
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#([0-9]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));

const xmlText = (value: string): string => xmlDecode(value.replace(/<[^>]+>/g, ""));

function xlsxSharedStrings(bytes: Uint8Array): readonly string[] {
  const xml = new TextDecoder().decode(zipEntry(bytes, "xl/sharedStrings.xml"));
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => xmlText([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((item) => item[1]).join("")));
}

function xlsxSheet(bytes: Uint8Array, name: string, shared: readonly string[]): readonly XlsxCell[] {
  const xml = new TextDecoder().decode(zipEntry(bytes, name));
  const cells: XlsxCell[] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/gi)) {
    const row = Number.parseInt(rowMatch[1], 10);
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const ref = /\br="([A-Z]+)(\d+)"/.exec(cellMatch[1]);
      if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(cellMatch[1])?.[1] ?? "";
      const body = cellMatch[2] ?? "";
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? "";
      const inline = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((item) => item[1]).join("");
      const value = type === "s" && raw !== "" ? (shared[Number.parseInt(raw, 10)] ?? "") : type === "inlineStr" ? xmlText(inline) : xmlDecode(raw);
      cells.push({ value, row, column: ref[1] });
    }
  }
  return cells;
}

const xlsxCell = (cells: readonly XlsxCell[], row: number, column: string): string => cells.find((cell) => cell.row === row && cell.column === column)?.value ?? "";
const xlsxNumeric = (cells: readonly XlsxCell[], row: number, column: string): number | null => {
  const value = xlsxCell(cells, row, column).trim();
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : null;
};

function parseArera227Xlsx(input: { readonly body: Uint8Array; readonly sourceReference: string; readonly publicationDate: string; readonly retrievedAt: string; readonly sourceSha256: string; readonly tenantId: string }): readonly RegulatoryValueRecord[] {
  const shared = xlsxSharedStrings(input.body);
  const records: RegulatoryValueRecord[] = [];
  for (let sheetNumber = 1; sheetNumber <= 12; sheetNumber += 1) {
    const sheetName = `xl/worksheets/sheet${sheetNumber}.xml`;
    let cells: readonly XlsxCell[];
    try { cells = xlsxSheet(input.body, sheetName, shared); } catch (error) {
      if (error instanceof Error && error.message.startsWith("ARERA_XLSX_ENTRY_MISSING")) break;
      throw error;
    }
    const title = `${xlsxCell(cells, 2, "A")} ${xlsxCell(cells, 6, "C")}`;
    const componentCode = title.includes("ARIM") ? "ARIM" : title.includes("ASOS") ? "ASOS" : null;
    if (!componentCode) continue;
    for (const [row, scope, fixedColumn] of [[10, "DOMESTIC_RESIDENT_BT", "C"], [11, "DOMESTIC_NON_RESIDENT_BT", "C"]] as const) {
      const energy = xlsxNumeric(cells, row, "E");
      const fixed = xlsxNumeric(cells, row, fixedColumn);
      const applicationBasis = componentCode === "ARIM"
        ? `Tabella B ufficiale ${componentCode}; valori confermati dal 01/07/2026, precedentemente in vigore secondo la fonte richiamata ${ARERA_227_IDENTIFIER}`
        : `Tabella A ufficiale ${componentCode}; classe di agevolazione 0; riga ${scope}`;
      if (fixed !== null) records.push(createValue({ tenantId: input.tenantId, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: input.sourceReference, officialIdentifier: ARERA_227_IDENTIFIER, publicationDate: input.publicationDate, retrievedAt: input.retrievedAt, effectiveFrom: "2026-07-01", effectiveTo: null, componentCode, customerScope: scope, originalValue: fixed, originalUnit: "CENT_EUR/POD/YEAR", applicationBasis, sourceSha256: input.sourceSha256 }));
      if (energy !== null) records.push(createValue({ tenantId: input.tenantId, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: input.sourceReference, officialIdentifier: ARERA_227_IDENTIFIER, publicationDate: input.publicationDate, retrievedAt: input.retrievedAt, effectiveFrom: "2026-07-01", effectiveTo: null, componentCode, customerScope: scope, originalValue: energy, originalUnit: "CENT_EUR/KWH", applicationBasis, sourceSha256: input.sourceSha256 }));
    }
  }
  if (records.length === 0) throw new Error("ARERA_227_XLSX_STRUCTURED_ROWS_MISSING");
  return records;
}

export function inspectAreraDomestic2026Xlsx(body: Uint8Array): { readonly sheetNames: readonly string[]; readonly periods: readonly string[]; readonly components: readonly string[]; readonly units: readonly string[] } {
  const shared = xlsxSharedStrings(body);
  const sheetNames: string[] = [];
  const periods: string[] = [];
  const components = new Set<string>();
  const units = new Set<string>();
  for (let sheetNumber = 1; sheetNumber <= 12; sheetNumber += 1) {
    let cells: readonly XlsxCell[];
    try { cells = xlsxSheet(body, `xl/worksheets/sheet${sheetNumber}.xml`, shared); } catch (error) {
      if (error instanceof Error && error.message.startsWith("ARERA_XLSX_ENTRY_MISSING")) break;
      throw error;
    }
    const period = xlsxCell(cells, 2, "B") || xlsxCell(cells, 2, "A");
    if (period) { sheetNames.push(period); periods.push(period); }
    /*
    for (const row of [11, 12]) for (const column of ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]) {
      const value = xlsxCell(cells, row, column).trim();
      if (value && /(?:dispacciamento|σ[123]|UC3|UC6|ASOS|ARIM|quota|euro|€/i/.test(value)) components.add(value);
    }
    */
    for (const row of [11, 12]) for (const column of ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]) {
      const value = xlsxCell(cells, row, column).trim();
      if (value) components.add(value);
    }
    for (const row of [14, 15, 16]) {
      const value = xlsxCell(cells, row, "B").trim();
      if (value) units.add(value);
    }
  }
  return { sheetNames, periods, components: [...components], units: [...units] };
}

export interface AreraDomesticJulyComponent {
  readonly rowIndex: number;
  readonly column: string;
  readonly officialLabel: string;
  readonly valuePresent: boolean;
  readonly originalValue: number | null;
  readonly originalUnit: string | null;
  readonly normalizedValue: number | null;
  readonly normalizedUnit: string | null;
  readonly section: string;
  readonly componentCode: RegulatoryValueComponentCode | null;
}

export interface AreraDomesticJulyDiagnostic {
  readonly sheetName: string;
  readonly rowCount: number;
  readonly componentCount: number;
  readonly unmappedCount: number;
  readonly rows: readonly AreraDomesticJulyComponent[];
}

const julyUnitForColumn = (column: string, row: number): string | null => {
  if ([14, 24].includes(row) && ["C", "F", "G", "H", "I", "J", "K", "L"].includes(column)) return "EUR/KWH";
  if ([15, 25].includes(row) && ["D", "I", "J", "K", "L"].includes(column)) return "EUR/POD/YEAR";
  if ([16, 26].includes(row) && ["E", "H", "I", "L"].includes(column)) return "EUR/KW/YEAR";
  return null;
};

const julyCodeForColumn = (column: string, row: number): RegulatoryValueComponentCode | null => {
  if (column === "C" && row === 14) return "DISPATCHING";
  if (column === "D" && row === 15) return "NETWORK_FIXED";
  if (column === "E" && row === 16) return "NETWORK_POWER";
  if (column === "F" && row === 14) return "TRANSMISSION_ENERGY";
  if (column === "G" && row === 14) return "UC3";
  if (column === "H" && row === 14) return "UC6";
  if (column === "H" && row === 16) return "UC6";
  if (column === "J" && row === 14) return "ASOS";
  if (column === "K" && row === 14) return "ARIM";
  return null;
};

const julyLabelForColumn = (column: string, row: number): string => {
  const labels: Record<string, string> = {
    C: row === 14 ? "Corrispettivo di dispacciamento" : "Quota energia — dispacciamento",
    D: "Tariffa uso rete elettrica — σ1 / quota fissa",
    E: "Tariffa uso rete elettrica — σ2 / quota potenza",
    F: "Tariffa uso rete elettrica — σ3 / quota energia trasmissione",
    G: "Oneri generali di sistema — UC3",
    H: row === 16 ? "Oneri generali di sistema — UC6 / quota potenza" : "Oneri generali di sistema — UC6 / quota energia",
    I: row === 15 ? "Totale tariffa uso rete — quota fissa" : row === 16 ? "Totale tariffa uso rete — quota potenza" : "Totale tariffa uso rete — quota energia",
    J: "Oneri generali di sistema — ASOS",
    K: "Oneri generali di sistema — ARIM",
    L: row === 15 ? "Totale oneri generali di sistema — quota fissa" : row === 16 ? "Totale oneri generali di sistema — quota potenza" : "Totale oneri generali di sistema — quota energia",
  };
  return labels[column] ?? `Voce ufficiale colonna ${column}`;
};

function xlsxSheetNames(body: Uint8Array): readonly { readonly name: string; readonly path: string }[] {
  const workbook = new TextDecoder().decode(zipEntry(body, "xl/workbook.xml"));
  return [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\bsheetId="(\d+)"/gi)].map((match, index) => ({ name: xmlDecode(match[1]), path: `xl/worksheets/sheet${index + 1}.xml` }));
}

export function parseAreraDomesticJuly2026Xlsx(body: Uint8Array): AreraDomesticJulyDiagnostic {
  const shared = xlsxSharedStrings(body);
  const sheet = xlsxSheetNames(body).find((item) => clean(item.name).toLowerCase() === "luglio 2026");
  if (!sheet) throw new Error("ARERA_JULY_2026_SHEET_MISSING");
  const cells = xlsxSheet(body, sheet.path, shared);
  const rows: AreraDomesticJulyComponent[] = [];
  for (const row of [14, 15, 16, 24, 25, 26]) {
    const section = row < 20 ? "DOMESTIC_RESIDENT_BT" : "DOMESTIC_NON_RESIDENT_BT";
    for (const column of ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]) {
      const raw = xlsxCell(cells, row, column).trim();
      if (!raw || raw === "-") continue;
      const value = xlsxNumeric(cells, row, column);
      if (value === null) continue;
      const unit = julyUnitForColumn(column, row);
      const code = section === "DOMESTIC_RESIDENT_BT" ? julyCodeForColumn(column, row) : null;
      const normalized = unit ? normalizeRegulatoryUnit(value, unit) : null;
      rows.push({ rowIndex: row, column, officialLabel: julyLabelForColumn(column, row), valuePresent: true, originalValue: value, originalUnit: unit, normalizedValue: normalized?.value ?? null, normalizedUnit: normalized?.unit ?? null, section, componentCode: code });
    }
  }
  return { sheetName: sheet.name, rowCount: rows.length, componentCount: rows.length, unmappedCount: rows.filter((row) => row.componentCode === null).length, rows };
}

export function parseArera227StructuredAttachment(input: { readonly body: string | Uint8Array; readonly contentType?: string; readonly sourceReference: string; readonly publicationDate: string; readonly retrievedAt: string; readonly sourceSha256?: string; readonly tenantId?: string }): readonly RegulatoryValueRecord[] {
  const type = (input.contentType ?? "").toLowerCase();
  const isSpreadsheet = type.includes("spreadsheet") || /\.(?:xls|xlsx)(?:$|\?)/i.test(input.sourceReference);
  const tenantId = input.tenantId ?? "tenant_local-demo";
  const sourceSha256 = input.sourceSha256 ?? textHash(typeof input.body === "string" ? input.body : new TextDecoder().decode(input.body));
  if (isSpreadsheet) {
    if (!(input.body instanceof Uint8Array) || !/\.xlsx(?:$|\?)/i.test(input.sourceReference)) throw new Error("ARERA_227_STRUCTURED_PARSE_BLOCKED");
    return parseArera227Xlsx({ body: input.body, sourceReference: input.sourceReference, publicationDate: input.publicationDate, retrievedAt: input.retrievedAt, sourceSha256, tenantId });
  }
  if (type.includes("pdf") || /\.pdf(?:$|\?)/i.test(input.sourceReference)) throw new Error("ARERA_227_STRUCTURED_PARSE_BLOCKED");
  if (typeof input.body !== "string") throw new Error("ARERA_227_STRUCTURED_PARSE_BLOCKED");
  const rows = type.includes("html") || /\.html?(?:$|\?)/i.test(input.sourceReference) ? tableRows(input.body) : input.body.split(/\r?\n/).map((line) => line.split(/[;,]/).map(clean)).filter((row) => row.length > 1);
  if (rows.length < 2) throw new Error("ARERA_227_STRUCTURED_PARSE_BLOCKED");
  const header = rows[0].map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const indexOf = (names: readonly string[], fallback: number): number => names.map((name) => header.indexOf(name)).find((index) => index >= 0) ?? fallback;
  const codeIndex = indexOf(["componentcode", "component", "codice"], 0);
  const valueIndex = indexOf(["originalvalue", "value", "valore"], 1);
  const unitIndex = indexOf(["originalunit", "unit", "unita"], 2);
  const scopeIndex = indexOf(["customerscope", "scope", "ambito"], 3);
  const fromIndex = indexOf(["effectivefrom", "decorrenza"], 4);
  const toIndex = indexOf(["effectiveto", "fine"], 5);
  const basisIndex = indexOf(["applicationbasis", "basis", "applicazione"], 6);
  return rows.slice(1).filter((row) => row[codeIndex]).map((row) => {
    const code = componentFor(row[codeIndex]);
    const effectiveFrom = clean(row[fromIndex] ?? "") || (code === "ASOS" ? "2026-07-01" : "2026-01-01");
    return createValue({ tenantId, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: input.sourceReference, officialIdentifier: ARERA_227_IDENTIFIER, publicationDate: input.publicationDate, retrievedAt: input.retrievedAt, effectiveFrom, effectiveTo: clean(row[toIndex] ?? "") || null, componentCode: code, customerScope: row[scopeIndex], originalValue: parseItalianNumber(row[valueIndex]), originalUnit: row[unitIndex], applicationBasis: clean(row[basisIndex] ?? "") || (code === "ARIM" ? "ARIM confermata dalla precedente decorrenza 01/01/2026" : `componente ${code} dal ${effectiveFrom}`), sourceSha256 });
  });
}

export function parseArera588Uc3Uc6TableRows(input: { readonly rows: readonly (readonly string[])[]; readonly sourceReference?: string; readonly publicationDate?: string; readonly retrievedAt: string; readonly sourceSha256: string; readonly tenantId?: string; readonly effectiveFrom?: string }): readonly RegulatoryValueRecord[] {
  const sourceReference = input.sourceReference ?? ARERA_588_TABLES_URL;
  const publicationDate = input.publicationDate ?? "2025-12-30";
  const tenantId = input.tenantId ?? "tenant_local-demo";
  const effectiveFrom = input.effectiveFrom ?? "2026-07-01";
  const sourceSha256 = input.sourceSha256;
  const domesticRow = input.rows.find((row) => (row[1] ?? "").toLowerCase().includes("utenza domestica in bassa tensione"));
  if (!domesticRow) throw new Error("ARERA_588_UC3_UC6_DOMESTIC_ROW_MISSING");
  const uc3 = Number((domesticRow[2] ?? "").replace(/,/g, "."));
  const uc6Power = Number((domesticRow[4] ?? "").replace(/,/g, "."));
  const uc6Energy = Number((domesticRow[5] ?? "").replace(/,/g, "."));
  if (![uc3, uc6Power, uc6Energy].every(Number.isFinite)) throw new Error("ARERA_588_UC3_UC6_VALUE_MISSING");
  const base = {
    tenantId, sourceType: "OFFICIAL_ATTACHMENT" as const, sourceReference, officialIdentifier: ARERA_588_IDENTIFIER,
    publicationDate, retrievedAt: input.retrievedAt, effectiveFrom, effectiveTo: null, customerScope: "DOMESTIC_BT",
    sourceSha256, carriedForwardFrom: "2026-01-01", confirmationSource: ARERA_227_PDF_URL,
    applicationBasis: "Tabella 7 della deliberazione 588/2025/R/com; valori originariamente vigenti dal 01/01/2026 e confermati dall'art. 1.4 della deliberazione 227/2026/R/com dal 01/07/2026",
  };
  return [
    createValue({ ...base, componentCode: "UC3", originalValue: uc3, originalUnit: "CENT_EUR/KWH" }),
    createValue({ ...base, componentCode: "UC6", originalValue: uc6Power, originalUnit: "CENT_EUR/KW/YEAR", applicationBasis: `${base.applicationBasis}; quota potenza` }),
    createValue({ ...base, componentCode: "UC6", originalValue: uc6Energy, originalUnit: "CENT_EUR/KWH", applicationBasis: `${base.applicationBasis}; quota energia` }),
  ];
}

export function parseArera588Uc3Uc6Xlsx(input: { readonly body: Uint8Array; readonly sourceReference?: string; readonly publicationDate?: string; readonly retrievedAt: string; readonly sourceSha256?: string; readonly tenantId?: string; readonly effectiveFrom?: string }): readonly RegulatoryValueRecord[] {
  const shared = xlsxSharedStrings(input.body);
  const cells = xlsxSheet(input.body, "xl/worksheets/sheet7.xml", shared);
  const rows = [...new Set(cells.map((cell) => cell.row))].map((row) => ["", xlsxCell(cells, row, "B"), xlsxCell(cells, row, "C"), "", xlsxCell(cells, row, "E"), xlsxCell(cells, row, "F")]);
  return parseArera588Uc3Uc6TableRows({ ...input, rows, sourceSha256: input.sourceSha256 ?? sourceHash(input.body) });
}

export function parseArera587Annual2026Values(input: { readonly retrievedAt: string; readonly sourceSha256: string; readonly tenantId?: string; readonly publicationDate?: string }): readonly RegulatoryValueRecord[] {
  const base = { tenantId: input.tenantId ?? "tenant_local-demo", sourceType: "OFFICIAL_PROVVEDIMENTO" as const, sourceReference: ARERA_587_PDF_URL, officialIdentifier: ARERA_587_IDENTIFIER, publicationDate: input.publicationDate ?? "2025-12-23", retrievedAt: input.retrievedAt, effectiveFrom: "2026-01-01", effectiveTo: "2027-01-01", customerScope: "ALL_ELECTRICITY", originalUnit: "CENT_EUR/KWH", sourceSha256: input.sourceSha256, authority: "ARERA" as const, publishedBy: "ARERA" as const, calculatedBy: "ARERA" as const, contractPassThroughRequired: true };
  return [
    createRegulatoryValue({ ...base, componentCode: "DISPATCHING_TERNA_OPERATION", originalValue: 0.0652, officialName: "Corrispettivo a copertura dei costi riconosciuti per il funzionamento di Terna", applicationBasis: "Deliberazione 587/2025/R/eel, art. 2 e tabella: p_y^fte per l'anno 2026" }),
    createRegulatoryValue({ ...base, componentCode: "DISPATCHING_ESSENTIAL_UNITS_REINTEGRATION", originalValue: 0.3041, officialName: "Corrispettivo a copertura dei costi delle unità essenziali in regime di reintegrazione", applicationBasis: "Deliberazione 587/2025/R/eel, art. 2 e tabella: p_y^urc per l'anno 2026" }),
  ];
}

export async function backupRegulatoryArchive(root: string): Promise<{ readonly path: string; readonly readable: boolean; readonly restoreCheck: boolean }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const source = path.join(root, "records.json");
  const backupDir = path.join(root, "..", "foundation-regulatory-backups", timestamp);
  const backupPath = path.join(backupDir, "records.json");
  await fs.mkdir(backupDir, { recursive: true });
  let content = "{\"revision\":0,\"sources\":[],\"documents\":[],\"rules\":[],\"series\":[],\"points\":[],\"evidence\":[],\"reviews\":[],\"versionStates\":[],\"regulatoryValues\":[]}";
  try { content = await fs.readFile(source, "utf8"); } catch (error) { if (!(error instanceof Error && "code" in error && (error as { readonly code?: unknown }).code === "ENOENT")) throw error; }
  await fs.writeFile(backupPath, content, "utf8");
  const readable = Boolean(JSON.parse(await fs.readFile(backupPath, "utf8")));
  const restoreCheck = (await fs.readFile(backupPath, "utf8")) === content;
  return { path: backupPath, readable, restoreCheck };
}

export function resolveAreraEffectiveValue(records: readonly RegulatoryValueRecord[], instant: string, componentCode: RegulatoryValueComponentCode, scope: RegulatoryCustomerScope, normalizedUnit?: string): RegulatoryValueRecord | null {
  const at = Date.parse(instant);
  const matches = records.filter((record) => record.componentCode === componentCode && (record.customerScope === scope || record.customerScope === "DOMESTIC_BT" || record.customerScope === "ALL_ELECTRICITY") && (!normalizedUnit || record.normalizedUnit === normalizedUnit) && Date.parse(record.effectiveFrom) <= at && (record.effectiveTo === null || at < Date.parse(record.effectiveTo)));
  if (matches.length > 1) throw new Error("ARERA_EFFECTIVE_VALUE_CONFLICT");
  return matches[0] ?? null;
}

export class AreraElectricityRegulatorySourceAdapter {
  private readonly repository: RegulatoryRepository;
  private readonly options: { readonly fetcher?: AreraFetcher; readonly regulatoryRoot?: string; readonly tenantId?: string };

  constructor(repository: RegulatoryRepository, options: { readonly fetcher?: AreraFetcher; readonly regulatoryRoot?: string; readonly tenantId?: string } = {}) {
    this.repository = repository;
    this.options = options;
  }

  async importOfficial(input: { readonly retrievedAt: string }): Promise<{ readonly infrastructure: AreraInfrastructureImport; readonly systemChargeRecords: readonly RegulatoryValueRecord[]; readonly attachment: AreraAttachment | null; readonly attachments: readonly AreraAttachment[]; readonly missingComponentCodes: readonly ("UC3" | "UC6")[]; readonly structuredParse: "PARSED" | "BLOCKED" | "MISSING"; readonly actions: readonly string[]; readonly backup: Awaited<ReturnType<typeof backupRegulatoryArchive>> | null; readonly documentCount: number; readonly documentsInspected: readonly string[]; readonly uc3SourceStrategy: "DIRECT_227" | "OFFICIAL_CARRY_FORWARD" | "UNRESOLVED"; readonly uc6SourceStrategy: "DIRECT_227" | "OFFICIAL_CARRY_FORWARD" | "UNRESOLVED"; readonly uc3PriorSourceIdentifier: string | null; readonly uc6PriorSourceIdentifier: string | null }> {
    const fetcher = this.options.fetcher ?? (fetch as unknown as AreraFetcher);
    const tenantId = this.options.tenantId ?? "tenant_local-demo";
    const infrastructurePayload = await fetchOfficialAreraSource(ARERA_575_PAGE, fetcher);
    const infrastructure = parseArera575DomesticInfrastructure({ html: new TextDecoder().decode(infrastructurePayload.bytes), sourceReference: infrastructurePayload.url, retrievedAt: input.retrievedAt, sourceSha256: sourceHash(infrastructurePayload.bytes), tenantId });
    const decisionPayload = await fetchOfficialAreraSource(ARERA_227_PAGE, fetcher);
    const attachments = discoverAreraAttachments(new TextDecoder().decode(decisionPayload.bytes));
    const structuredAttachments = attachments.filter((item) => ["XLSX", "CSV", "HTML"].includes(item.extension));
    const attachment = structuredAttachments[0] ?? attachments.find((item) => ["XLSX", "XLS", "CSV", "HTML", "PDF"].includes(item.extension)) ?? null;
    let systemChargeRecords: RegulatoryValueRecord[] = [];
    let structuredParse: "PARSED" | "BLOCKED" | "MISSING" = "MISSING";
    for (const currentAttachment of structuredAttachments) {
      try {
        if (currentAttachment.extension === "XLSX") {
          const attachmentPayload = await fetchOfficialAreraSource(currentAttachment.url, fetcher);
          systemChargeRecords = [...systemChargeRecords, ...parseArera227StructuredAttachment({ body: attachmentPayload.bytes, contentType: attachmentPayload.contentType, sourceReference: attachmentPayload.url, publicationDate: "2026-06-25", retrievedAt: input.retrievedAt, sourceSha256: sourceHash(attachmentPayload.bytes), tenantId })];
        } else {
          const attachmentPayload = await fetchOfficialAreraSource(currentAttachment.url, fetcher);
          systemChargeRecords = [...systemChargeRecords, ...parseArera227StructuredAttachment({ body: new TextDecoder().decode(attachmentPayload.bytes), contentType: currentAttachment.extension === "HTML" ? "text/html" : "text/csv", sourceReference: attachmentPayload.url, publicationDate: "2026-06-25", retrievedAt: input.retrievedAt, sourceSha256: sourceHash(attachmentPayload.bytes), tenantId })];
        }
        structuredParse = "PARSED";
      } catch (error) {
        if (error instanceof Error && error.message.includes("BLOCKED")) structuredParse = systemChargeRecords.length ? "PARSED" : "BLOCKED";
        else if (error instanceof Error && error.message === "ARERA_227_XLSX_STRUCTURED_ROWS_MISSING") continue;
        else throw error;
      }
    }
    if (!structuredAttachments.length && attachment?.extension === "PDF") structuredParse = "BLOCKED";
    const uniqueRecords = new Map<string, RegulatoryValueRecord>();
    for (const record of systemChargeRecords) {
      const existing = uniqueRecords.get(record.identityKey);
      if (existing && (existing.originalValue !== record.originalValue || existing.originalUnit !== record.originalUnit || existing.normalizedValue !== record.normalizedValue || existing.normalizedUnit !== record.normalizedUnit)) throw new Error("ARERA_SOURCE_CONFLICT");
      if (!existing) uniqueRecords.set(record.identityKey, record);
    }
    systemChargeRecords = [...uniqueRecords.values()];
    const initialKnownCodes = new Set(systemChargeRecords.map((record) => record.componentCode));
    const documentsInspected: string[] = [];
    for (const currentAttachment of attachments) {
      if (structuredAttachments.some((item) => item.url === currentAttachment.url)) continue;
      const payload = await fetchOfficialAreraSource(currentAttachment.url, fetcher);
      documentsInspected.push(payload.url);
    }
    let uc3SourceStrategy: "DIRECT_227" | "OFFICIAL_CARRY_FORWARD" | "UNRESOLVED" = initialKnownCodes.has("UC3") ? "DIRECT_227" : "UNRESOLVED";
    let uc6SourceStrategy: "DIRECT_227" | "OFFICIAL_CARRY_FORWARD" | "UNRESOLVED" = initialKnownCodes.has("UC6") ? "DIRECT_227" : "UNRESOLVED";
    if (!initialKnownCodes.has("UC3") || !initialKnownCodes.has("UC6")) {
      const priorPayload = await fetchOfficialAreraSource(ARERA_588_TABLES_URL, fetcher);
      const priorRecords = parseArera588Uc3Uc6Xlsx({ body: priorPayload.bytes, sourceReference: priorPayload.url, retrievedAt: input.retrievedAt, sourceSha256: sourceHash(priorPayload.bytes), tenantId });
      systemChargeRecords = [...systemChargeRecords, ...priorRecords];
      if (!initialKnownCodes.has("UC3")) uc3SourceStrategy = "OFFICIAL_CARRY_FORWARD";
      if (!initialKnownCodes.has("UC6")) uc6SourceStrategy = "OFFICIAL_CARRY_FORWARD";
    }
    const knownCodes = new Set(systemChargeRecords.map((record) => record.componentCode));
    const missingComponentCodes = (["UC3", "UC6"] as const).filter((code) => !knownCodes.has(code));
    const allRecords = [...infrastructure.records, ...systemChargeRecords];
    const backup = allRecords.length && this.options.regulatoryRoot ? await backupRegulatoryArchive(this.options.regulatoryRoot) : null;
    const actions: string[] = [];
    for (const record of allRecords) actions.push(await this.repository.saveRegulatoryValue(record));
    return { infrastructure, systemChargeRecords, attachment, attachments, missingComponentCodes, structuredParse, actions, backup, documentCount: attachments.length, documentsInspected: [...new Set([...attachments.map((item) => item.url), ...documentsInspected])], uc3SourceStrategy, uc6SourceStrategy, uc3PriorSourceIdentifier: uc3SourceStrategy === "OFFICIAL_CARRY_FORWARD" ? ARERA_588_IDENTIFIER : null, uc6PriorSourceIdentifier: uc6SourceStrategy === "OFFICIAL_CARRY_FORWARD" ? ARERA_588_IDENTIFIER : null };
  }
}
