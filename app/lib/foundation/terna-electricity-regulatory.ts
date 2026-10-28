import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { RegulatoryValueRecord } from "./regulatory-types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createRegulatoryValue, isAllowedOfficialRegulatoryUrl } from "./arera-electricity-regulatory.ts";

export const TERNA_CORRISPETTIVI_PAGE = "https://dati.terna.it/corrispettivi";
export const TERNA_DISPATCHING_DATASOURCE = "E09352AE-CE30-4190-8956-F534D3EC4370";
export const TERNA_CAPACITY_DATASOURCE = "EF47860A-9A26-4C5E-9FB9-408EFA3E970E";
export const TERNA_GET_ENDPOINT = "https://dati.terna.it/api/sitecore/dati/corrispettivi/get";

const sourceHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export interface TernaEndpointDiscovery {
  readonly frontendScriptCount: number;
  readonly networkEndpointCandidates: readonly string[];
  readonly dispatchingEndpoint: string;
  readonly capacityEndpoint: string;
  readonly dispatchingDatasource: string;
  readonly capacityDatasource: string;
}

export interface TernaFetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly text: () => Promise<string>;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

export type TernaFetcher = (input: string, init?: RequestInit) => Promise<TernaFetchResponse>;

function assertTernaUrl(url: string): void {
  if (!isAllowedOfficialRegulatoryUrl(url) || !new URL(url).hostname.toLowerCase().endsWith("terna.it")) throw new Error("TERNA_DOMAIN_NOT_ALLOWED");
}

async function fetchTerna(url: string, fetcher: TernaFetcher): Promise<{ readonly url: string; readonly bytes: Uint8Array; readonly contentType: string }> {
  assertTernaUrl(url);
  const response = await fetcher(url, { headers: { Accept: "text/html,application/pdf,application/json,application/javascript", "User-Agent": "BillRegulatoryAuditEngine/1.0 (official-source-import)" } });
  if (response.status < 200 || response.status >= 300) throw new Error(`TERNA_HTTP_${response.status}`);
  return { url, bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "" };
}

export async function discoverTernaCorrispettiviEndpoints(fetcher: TernaFetcher = fetch as unknown as TernaFetcher): Promise<TernaEndpointDiscovery> {
  const page = await fetchTerna(TERNA_CORRISPETTIVI_PAGE, fetcher);
  const html = new TextDecoder().decode(page.bytes);
  const scriptUrls = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => new URL(match[1], TERNA_CORRISPETTIVI_PAGE).toString());
  const officialScriptUrls = [...new Set(scriptUrls.filter((url) => isAllowedOfficialRegulatoryUrl(url)))];
  const bundles: string[] = [];
  for (const url of officialScriptUrls) bundles.push(new TextDecoder().decode((await fetchTerna(url, fetcher)).bytes));
  const endpointPaths = [...new Set(bundles.flatMap((bundle) => [...bundle.matchAll(/\/api\/sitecore\/dati\/corrispettivi\/[A-Za-z]+/g)].map((match) => match[0])))].sort();
  const endpointUrls = endpointPaths.map((path) => new URL(path, TERNA_CORRISPETTIVI_PAGE).toString());
  const getEndpoint = endpointUrls.find((url) => url.endsWith("/get"));
  if (!getEndpoint) throw new Error("TERNA_GET_ENDPOINT_NOT_FOUND");
  const dispatchingDatasource = html.includes(TERNA_DISPATCHING_DATASOURCE) ? TERNA_DISPATCHING_DATASOURCE : (() => { throw new Error("TERNA_TIDE_DATASOURCE_NOT_FOUND"); })();
  const capacityDatasource = html.includes(TERNA_CAPACITY_DATASOURCE) ? TERNA_CAPACITY_DATASOURCE : (() => { throw new Error("TERNA_CAPACITY_DATASOURCE_NOT_FOUND"); })();
  return { frontendScriptCount: scriptUrls.length, networkEndpointCandidates: endpointUrls, dispatchingEndpoint: getEndpoint, capacityEndpoint: getEndpoint, dispatchingDatasource, capacityDatasource };
}

const queryTerna = async (endpoint: string, datasource: string, fetcher: TernaFetcher): Promise<{ readonly Results?: readonly Record<string, unknown>[] }> => {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ datasource, year: "2026", month: "0", day: "", datePublishing: "", type: "", area: "", pageNumber: "0", pageSize: "100", orderBy: "0", orderDirection: "desc", language: "it-IT", searchTerm: "", upType: "", quarter: "" }).toString();
  const response = await fetchTerna(url.toString(), fetcher);
  return JSON.parse(new TextDecoder().decode(response.bytes)) as { readonly Results?: readonly Record<string, unknown>[] };
};

const absoluteTernaUrl = (value: string): string => new URL(value, TERNA_CORRISPETTIVI_PAGE).toString();
const q3Document = (results: readonly Record<string, unknown>[]): Record<string, unknown> => {
  const result = results.find((item) => /(?:3Q2026|3°\s*trimestre\s*2026|3\s*trimestre\s*2026)/i.test(String(item.Title ?? "")));
  if (!result || typeof result.Url !== "string" || typeof result.PublicationDate !== "string") throw new Error("TERNA_Q3_2026_DOCUMENT_MISSING");
  return result;
};

const pdfStreams = (body: Uint8Array): readonly string[] => {
  const raw = Buffer.from(body).toString("latin1");
  const streams: string[] = [];
  for (const match of raw.matchAll(/(?:^|\r?\n)stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const before = raw.slice(Math.max(0, (match.index ?? 0) - 1200), match.index ?? 0);
    const bytes = new Uint8Array([...match[1]].map((char) => char.charCodeAt(0) & 255));
    try { streams.push(Buffer.from(/FlateDecode/.test(before) ? inflateSync(bytes) : bytes).toString("latin1")); } catch { /* non-content streams are ignored */ }
  }
  return streams;
};

const pdfText = (body: Uint8Array): string => pdfStreams(body).map((stream) => [...stream.matchAll(/\(([^()]*)\)/g)].map((match) => match[1]).join("")).join(" ");
const publishedDecimal = (body: Uint8Array, value: string): number => {
  const text = pdfText(body);
  const candidates = [value, value.replace(".", ",")];
  if (!candidates.some((candidate) => text.includes(candidate))) throw new Error(`TERNA_PDF_VALUE_NOT_FOUND:${value}`);
  return Number(value.replace(",", "."));
};
const publicationDate = (value: string): string => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value);
  if (!match) throw new Error("TERNA_PUBLICATION_DATE_INVALID");
  return `${match[3]}-${match[2]}-${match[1]}`;
};

export interface TernaQ3Import {
  readonly discovery: TernaEndpointDiscovery;
  readonly tideRecords: readonly RegulatoryValueRecord[];
  readonly capacityRecords: readonly RegulatoryValueRecord[];
  readonly tideDocument: { readonly url: string; readonly publicationDate: string; readonly sourceSha256: string };
  readonly capacityDocument: { readonly url: string; readonly publicationDate: string; readonly sourceSha256: string };
  readonly tideValueExtraction: "EXTRACTED" | "BLOCKED_NO_TEXT";
}

export async function importTernaQ3Official(input: { readonly tenantId?: string; readonly retrievedAt: string; readonly fetcher?: TernaFetcher }): Promise<TernaQ3Import> {
  const fetcher = input.fetcher ?? (fetch as unknown as TernaFetcher);
  const discovery = await discoverTernaCorrispettiviEndpoints(fetcher);
  const tideListing = await queryTerna(discovery.dispatchingEndpoint, discovery.dispatchingDatasource, fetcher);
  const capacityListing = await queryTerna(discovery.capacityEndpoint, discovery.capacityDatasource, fetcher);
  const tideItem = q3Document(tideListing.Results ?? []);
  const capacityItem = q3Document(capacityListing.Results ?? []);
  const tide = await fetchTerna(absoluteTernaUrl(String(tideItem.Url)), fetcher);
  const capacity = await fetchTerna(absoluteTernaUrl(String(capacityItem.Url)), fetcher);
  const tideUrl = tide.url;
  const capacityUrl = capacity.url;
  const tidePublicationDate = publicationDate(String(tideItem.PublicationDate));
  const capacityPublicationDate = publicationDate(String(capacityItem.PublicationDate));
  const tideHash = sourceHash(tide.bytes);
  const capacityHash = sourceHash(capacity.bytes);
  const base = { tenantId: input.tenantId ?? "tenant_local-demo", sourceType: "OFFICIAL_ATTACHMENT" as const, effectiveFrom: "2026-07-01", effectiveTo: "2026-10-01", customerScope: "DOMESTIC_RESIDENT_BT", retrievedAt: input.retrievedAt };
  const tideText = pdfText(tide.bytes);
  const tideValuesAvailable = ["1.0501000", "0.3326000", "0.3042000", "0.1301000"].every((value) => tideText.includes(value) || tideText.includes(value.replace(".", ",")));
  const tideValue = (componentCode: Parameters<typeof createRegulatoryValue>[0]["componentCode"], value: string, name: string) => tideValuesAvailable ? createRegulatoryValue({ ...base, authority: "TERNA", publishedBy: "TERNA", calculatedBy: "TERNA", sourceReference: tideUrl, officialIdentifier: "TERNA_TIDE_Q3_2026", publicationDate: tidePublicationDate, componentCode, regulatoryVariant: "TIDE", originalValue: publishedDecimal(tide.bytes, value), originalUnit: "CENT_EUR/KWH", officialName: name, applicationBasis: "Corrispettivi di dispacciamento ai sensi del TIDE; trimestre 3 2026", sourceSha256: tideHash, contractPassThroughRequired: true }) : null;
  const tideRecords = [
    tideValue("DISPATCHING_TOTAL", "1.0501000", "Corrispettivo di dispacciamento (TIDE)"),
    tideValue("DISPATCHING_UPLIFT", "0.3326000", "Uplift TIDE"),
    tideValue("DISPATCHING_UPLIFT_ATT_MSDMB", "0.0761000", "Uplift TIDE — ATT MSDMB"),
    tideValue("DISPATCHING_UPLIFT_ATT_DED", "0.1963000", "Uplift TIDE — ATT DED"),
    tideValue("DISPATCHING_UPLIFT_RUPL", "0.0601000", "Uplift TIDE — RUPL"),
    tideValue("DISPATCHING_ESSENTIAL_UNITS", "0.3042000", "Unità essenziali in regime di reintegrazione — totale"),
    tideValue("DISPATCHING_ESSENTIAL_UNITS_ORDINARY", "0.0001000", "Unità essenziali — componente ordinaria"),
    tideValue("DISPATCHING_EXTRAORDINARY_MODULATION", "0.1301000", "Modulazione straordinaria"),
  ].filter((value): value is RegulatoryValueRecord => value !== null);
  const capacityValue = publishedDecimal(capacity.bytes, "3,197");
  const capacityRecords = [createRegulatoryValue({ ...base, authority: "TERNA", publishedBy: "TERNA", calculatedBy: "TERNA", sourceReference: capacityUrl, officialIdentifier: "TERNA_CAPACITY_MARKET_Q3_2026", publicationDate: capacityPublicationDate, componentCode: "CAPACITY_MARKET_OFF_PEAK", originalValue: capacityValue, originalUnit: "EUR/MWH", officialName: "Corrispettivo unitario ore diverse dalle ore di picco del sistema elettrico", applicationBasis: "Corrispettivo mercato della capacità — 3° trimestre 2026; documento ufficiale riferito alle ore diverse dalle ore di picco", sourceSha256: capacityHash, contractPassThroughRequired: true })];
  return { discovery, tideRecords, capacityRecords, tideDocument: { url: tideUrl, publicationDate: tidePublicationDate, sourceSha256: tideHash }, capacityDocument: { url: capacityUrl, publicationDate: capacityPublicationDate, sourceSha256: capacityHash }, tideValueExtraction: tideValuesAvailable ? "EXTRACTED" : "BLOCKED_NO_TEXT" };
}

export interface TernaQuarter {
  readonly year: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
}

/** The calendar quarter containing `date`, shifted by `offset` quarters. */
export function ternaQuarterFor(date: string, offset = 0): TernaQuarter {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("TERNA_QUARTER_DATE_INVALID");
  const index = parsed.getUTCFullYear() * 4 + Math.floor(parsed.getUTCMonth() / 3) + offset;
  const year = Math.floor(index / 4);
  const quarter = (index % 4) + 1 as TernaQuarter["quarter"];
  const iso = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { year, quarter, effectiveFrom: iso(year, (quarter - 1) * 3), effectiveTo: iso(year, quarter * 3) };
}

/** Terna titles name a quarter as "3Q2026", "3° trimestre 2026" or "III trimestre 2026". */
export function ternaTitleMatchesQuarter(title: string, { year, quarter }: Pick<TernaQuarter, "year" | "quarter">): boolean {
  const roman = ["I", "II", "III", "IV"][quarter - 1];
  return new RegExp(`(?:\\b${quarter}\\s*Q\\s*${year}\\b|\\bQ${quarter}\\s*${year}\\b|\\b${quarter}\\s*[°º^]?\\s*trimestre\\s*(?:del\\s*|anno\\s*)?${year}\\b|\\b${roman}\\s+trimestre\\s*(?:del\\s*|anno\\s*)?${year}\\b)`, "i").test(title);
}

const decimalPattern = "(\\d{1,3}(?:[.,]\\d{1,7}))";

/** Reads the capacity-market unit charges (EUR/MWh) from the text of Terna's quarterly document. */
export function extractTernaCapacityValues(text: string): { readonly offPeak: number; readonly peak: number | null } {
  const flat = text.replace(/\s+/g, " ");
  const read = (pattern: RegExp): number | null => {
    const match = pattern.exec(flat);
    if (!match) return null;
    const value = Number(match[1].replace(",", "."));
    return Number.isFinite(value) && value > 0 && value < 100 ? value : Number.NaN;
  };
  const offPeak = read(new RegExp(`ore\\s+diverse\\s+dalle\\s+ore\\s+di\\s+picco[^0-9]{0,240}?${decimalPattern}`, "i"));
  if (offPeak === null) throw new Error("TERNA_CAPACITY_VALUE_NOT_FOUND");
  if (Number.isNaN(offPeak)) throw new Error("TERNA_CAPACITY_VALUE_IMPLAUSIBLE");
  // The peak charge is optional: a document may publish only the off-peak one.
  const peakRead = read(new RegExp(`(?<!dalle\\s)ore\\s+di\\s+picco[^0-9]{0,240}?${decimalPattern}`, "i"));
  const peak = peakRead === null || Number.isNaN(peakRead) ? null : peakRead;
  return { offPeak, peak: peak === offPeak ? null : peak };
}

export interface TernaCapacityQuarterImport {
  readonly quarter: TernaQuarter;
  readonly document: { readonly url: string; readonly title: string; readonly publicationDate: string; readonly sourceSha256: string };
  readonly records: readonly RegulatoryValueRecord[];
}

export const TERNA_CAPACITY_SCOPES = ["DOMESTIC_RESIDENT_BT", "NON_DOMESTIC_BT_BTA6"] as const;

/** Finds Terna's capacity-market document for one quarter and turns its unit charges into regulatory values. */
export async function importTernaCapacityQuarter(input: { readonly tenantId: string; readonly retrievedAt: string; readonly quarter: TernaQuarter; readonly fetcher?: TernaFetcher; readonly discovery?: TernaEndpointDiscovery }): Promise<TernaCapacityQuarterImport> {
  const fetcher = input.fetcher ?? (fetch as unknown as TernaFetcher);
  const discovery = input.discovery ?? await discoverTernaCorrispettiviEndpoints(fetcher);
  const url = new URL(discovery.capacityEndpoint);
  url.search = new URLSearchParams({ datasource: discovery.capacityDatasource, year: String(input.quarter.year), month: "0", day: "", datePublishing: "", type: "", area: "", pageNumber: "0", pageSize: "100", orderBy: "0", orderDirection: "desc", language: "it-IT", searchTerm: "", upType: "", quarter: "" }).toString();
  const listing = JSON.parse(new TextDecoder().decode((await fetchTerna(url.toString(), fetcher)).bytes)) as { readonly Results?: readonly Record<string, unknown>[] };
  const item = (listing.Results ?? []).find((result) => ternaTitleMatchesQuarter(String(result.Title ?? ""), input.quarter));
  if (!item || typeof item.Url !== "string" || typeof item.PublicationDate !== "string") throw new Error("TERNA_CAPACITY_DOCUMENT_NOT_PUBLISHED");
  const document = await fetchTerna(absoluteTernaUrl(item.Url), fetcher);
  const values = extractTernaCapacityValues(pdfText(document.bytes));
  const sha = sourceHash(document.bytes);
  const published = publicationDate(item.PublicationDate);
  const label = `${input.quarter.quarter}° trimestre ${input.quarter.year}`;
  const record = (componentCode: "CAPACITY_MARKET_OFF_PEAK" | "CAPACITY_MARKET_PEAK", value: number, customerScope: typeof TERNA_CAPACITY_SCOPES[number]) => createRegulatoryValue({
    tenantId: input.tenantId, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: document.url, officialIdentifier: `TERNA_CAPACITY_MARKET_${input.quarter.year}Q${input.quarter.quarter}`, publicationDate: published, retrievedAt: input.retrievedAt,
    effectiveFrom: input.quarter.effectiveFrom, effectiveTo: input.quarter.effectiveTo, componentCode, customerScope, originalValue: value, originalUnit: "EUR/MWH",
    authority: "TERNA", publishedBy: "TERNA", calculatedBy: "TERNA",
    officialName: componentCode === "CAPACITY_MARKET_PEAK" ? "Corrispettivo unitario ore di picco del sistema elettrico" : "Corrispettivo unitario ore diverse dalle ore di picco del sistema elettrico",
    applicationBasis: `Corrispettivo mercato della capacità — ${label}; documento ufficiale Terna "${String(item.Title)}"`, sourceSha256: sha, contractPassThroughRequired: true,
  });
  const records = TERNA_CAPACITY_SCOPES.flatMap((scope) => [record("CAPACITY_MARKET_OFF_PEAK", values.offPeak, scope), ...(values.peak === null ? [] : [record("CAPACITY_MARKET_PEAK", values.peak, scope)])]);
  return { quarter: input.quarter, document: { url: document.url, title: String(item.Title), publicationDate: published, sourceSha256: sha }, records };
}

/** The total TIDE dispatching charge (c€/kWh) of Terna's quarterly document: it is the sum of the published elements
 *  (uplift, unità essenziali, modulazione, ...), so it is the largest of the values printed with seven decimals. */
export function extractTernaTideTotal(text: string): number {
  const values = [...text.matchAll(/(?<![\d.,])(-?\d{1,2}[.,]\d{7})(?![\d])/g)].map((match) => Number(match[1].replace(",", "."))).filter((value) => Number.isFinite(value));
  if (values.length < 2) throw new Error("TERNA_TIDE_VALUE_NOT_FOUND");
  const total = Math.max(...values);
  if (!(total > 0 && total < 10)) throw new Error("TERNA_TIDE_VALUE_IMPLAUSIBLE");
  return total;
}

export interface TernaTideQuarterImport {
  readonly quarter: TernaQuarter;
  readonly document: { readonly url: string; readonly title: string; readonly publicationDate: string; readonly sourceSha256: string };
  readonly records: readonly RegulatoryValueRecord[];
}

/** Finds Terna's TIDE dispatching document for one quarter: one total for customers other than households. */
export async function importTernaTideQuarter(input: { readonly tenantId: string; readonly retrievedAt: string; readonly quarter: TernaQuarter; readonly fetcher?: TernaFetcher; readonly discovery?: TernaEndpointDiscovery }): Promise<TernaTideQuarterImport> {
  const fetcher = input.fetcher ?? (fetch as unknown as TernaFetcher);
  const discovery = input.discovery ?? await discoverTernaCorrispettiviEndpoints(fetcher);
  const url = new URL(discovery.dispatchingEndpoint);
  url.search = new URLSearchParams({ datasource: discovery.dispatchingDatasource, year: String(input.quarter.year), month: "0", day: "", datePublishing: "", type: "", area: "", pageNumber: "0", pageSize: "100", orderBy: "0", orderDirection: "desc", language: "it-IT", searchTerm: "", upType: "", quarter: "" }).toString();
  const listing = JSON.parse(new TextDecoder().decode((await fetchTerna(url.toString(), fetcher)).bytes)) as { readonly Results?: readonly Record<string, unknown>[] };
  const item = (listing.Results ?? []).find((result) => ternaTitleMatchesQuarter(String(result.Title ?? ""), input.quarter));
  if (!item || typeof item.Url !== "string" || typeof item.PublicationDate !== "string") throw new Error("TERNA_TIDE_DOCUMENT_NOT_PUBLISHED");
  const document = await fetchTerna(absoluteTernaUrl(item.Url), fetcher);
  const total = extractTernaTideTotal(pdfText(document.bytes));
  const sha = sourceHash(document.bytes);
  const published = publicationDate(item.PublicationDate);
  const record = createRegulatoryValue({
    tenantId: input.tenantId, sourceType: "OFFICIAL_ATTACHMENT", sourceReference: document.url, officialIdentifier: `TERNA_TIDE_${input.quarter.year}Q${input.quarter.quarter}`, publicationDate: published, retrievedAt: input.retrievedAt,
    effectiveFrom: input.quarter.effectiveFrom, effectiveTo: input.quarter.effectiveTo, componentCode: "DISPATCHING_TOTAL", customerScope: "NON_DOMESTIC_BT", regulatoryVariant: "TIDE", originalValue: total, originalUnit: "CENT_EUR/KWH",
    authority: "TERNA", publishedBy: "TERNA", calculatedBy: "TERNA", officialName: "Corrispettivo di dispacciamento (TIDE)",
    applicationBasis: `Corrispettivi di dispacciamento ai sensi del TIDE — ${input.quarter.quarter}° trimestre ${input.quarter.year}; documento ufficiale Terna "${String(item.Title)}"; al netto delle perdite`, sourceSha256: sha, contractPassThroughRequired: true,
  });
  return { quarter: input.quarter, document: { url: document.url, title: String(item.Title), publicationDate: published, sourceSha256: sha }, records: [record] };
}
