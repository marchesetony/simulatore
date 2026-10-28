import { createHash } from "node:crypto";
import type { RegulatoryValueRecord } from "../foundation/regulatory-types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { createRegulatoryValue, fetchOfficialAreraSource, type AreraFetcher } from "../foundation/arera-electricity-regulatory.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { expandPdfObjectStreams, pdfCompactText } from "./pdf-text.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { applyRegulatoryRefreshCandidate, type RegulatoryRefreshDependencies } from "./service.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ARERA_CAPACITY_DOMAIN } from "./registry.ts";

// Tony (27/10): "sono dati che devi aggiornare mensilmente in automatico da ARERA". ARERA fixes the corrispettivo mercato
// capacità for BT up to 55 kW month by month in the quarterly TIV updates (art. 4.1: "a) 0,3197 c€/kWh per il mese di
// settembre 2026"). The refresh reads the resolutions the TIV page cites, takes art. 4.1 from each resolution's PDF and
// stores one approved value per month, so a new quarter lands on its own as soon as ARERA publishes it.

export { expandPdfObjectStreams, pdfCompactText };

export const ARERA_TIV_PAGE = "https://www.arera.it/atti-e-provvedimenti/dettaglio/23/362-23";
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"] as const;
const MAX_RESOLUTIONS = 10;

export interface AreraResolutionId { readonly number: number; readonly year: number }
export interface AreraCapacityResolution { readonly resolution: string; readonly url: string; readonly publicationDate: string | null; readonly months: readonly { readonly month: string; readonly centsPerKwh: number }[]; readonly sourceSha256: string }

const resolutionLabel = (id: AreraResolutionId): string => `${id.number}/${id.year}/R/eel`;
export const areraResolutionPdfUrl = (id: AreraResolutionId): string => `https://www.arera.it/fileadmin/allegati/docs/${String(id.year).slice(2)}/${id.number}-${id.year}-R-eel.pdf`;

/** The electricity resolutions the TIV page cites (linked acts and the "Versione modificata con ..." notes), newest first. */
export function discoverTivResolutions(html: string, now: string): readonly AreraResolutionId[] {
  const found = new Map<string, AreraResolutionId>();
  const add = (number: number, year: number) => { if (number > 0 && year >= 2000) found.set(`${year}-${number}`, { number, year }); };
  for (const match of html.matchAll(/(\d{1,4})\/(20\d{2})\/R\/eel/gi)) add(Number(match[1]), Number(match[2]));
  for (const match of html.matchAll(/\/atti-e-provvedimenti\/dettaglio\/(\d{2})\/0*(\d{1,4})-(\d{2})\b/g)) if (match[1] === match[3]) add(Number(match[2]), 2000 + Number(match[1]));
  const minimumYear = new Date(now).getUTCFullYear() - 1;
  return [...found.values()].filter((id) => id.year >= minimumYear && !(id.number === 362 && id.year === 2023))
    .sort((left, right) => right.year - left.year || right.number - left.number).slice(0, MAX_RESOLUTIONS);
}

const decimal = (value: string): number => Number(value.replace(/\./g, "").replace(",", "."));

/** Art. 4.1 of a quarterly TIV update: one value in c€/kWh per month, net of losses. Empty when the resolution has none. */
export function parseAreraCapacityText(compact: string): { readonly publicationDate: string | null; readonly months: readonly { readonly month: string; readonly centsPerKwh: number }[] } {
  const date = compact.match(/DELIBERAZIONE(\d{1,2})([A-Za-z]+)(20\d{2})/i);
  const dateMonth = date ? MONTHS.indexOf(date[2].toLowerCase() as typeof MONTHS[number]) : -1;
  const publicationDate = date && dateMonth >= 0 ? `${date[3]}-${String(dateMonth + 1).padStart(2, "0")}-${date[1].padStart(2, "0")}` : null;
  // Every mention of the capacity charge, not only the first: 338/2026 names the quarterly PD element ("corrispettivo
  // mercato capacità ... 0,6193") in its premises before art. 4.1, and October 2026 was missed (Tony, 28/10).
  const anchors = [...compact.matchAll(/corrispettivo(?:di)?(?:mercato)?(?:della)?capacit/gi)].map((match) => match.index ?? 0);
  if (anchors.length === 0) return { publicationDate, months: [] };
  const window = anchors.map((anchor) => compact.slice(anchor, anchor + 1500)).join("|");
  const months = new Map<string, number>();
  for (const match of window.matchAll(new RegExp(`(\\d{1,2},\\d{2,6})c.{0,2}?/kWhperilmesedi(${MONTHS.join("|")})(20\\d{2})`, "gi"))) {
    const month = `${match[3]}-${String(MONTHS.indexOf(match[2].toLowerCase() as typeof MONTHS[number]) + 1).padStart(2, "0")}`;
    const value = decimal(match[1]);
    if (Number.isFinite(value) && value >= 0 && !months.has(month)) months.set(month, value);
  }
  return { publicationDate, months: [...months].map(([month, centsPerKwh]) => ({ month, centsPerKwh })).sort((left, right) => left.month.localeCompare(right.month)) };
}

export interface AreraCapacitySourceReader {
  load(input: { readonly retrievedAt: string }): Promise<{ readonly resolutions: readonly AreraCapacityResolution[]; readonly errors: readonly string[] }>;
}

export function createAreraCapacitySourceReader(input: { readonly fetcher?: AreraFetcher } = {}): AreraCapacitySourceReader {
  return {
    async load({ retrievedAt }) {
      const page = await fetchOfficialAreraSource(ARERA_TIV_PAGE, input.fetcher);
      const ids = discoverTivResolutions(new TextDecoder().decode(page.bytes), retrievedAt);
      if (ids.length === 0) throw new Error("ARERA_TIV_RESOLUTIONS_NOT_FOUND");
      const resolutions: AreraCapacityResolution[] = []; const errors: string[] = [];
      for (const id of ids) {
        const url = areraResolutionPdfUrl(id);
        try {
          const source = await fetchOfficialAreraSource(url, input.fetcher);
          const { text, sourceSha256 } = pdfCompactText(source.bytes);
          const parsed = parseAreraCapacityText(text);
          if (parsed.months.length) resolutions.push({ resolution: resolutionLabel(id), url, publicationDate: parsed.publicationDate, months: parsed.months, sourceSha256 });
        } catch (error) {
          // Not every resolution the TIV cites has an R/eel PDF at the usual address (DIME, R/com): only failures count.
          const message = error instanceof Error ? error.message : "ARERA_SOURCE_FAILED";
          if (message !== "ARERA_HTTP_404") errors.push(`${resolutionLabel(id)}:${message}`);
        }
      }
      return { resolutions, errors };
    },
  };
}

const nextMonth = (month: string): string => { const [year, value] = month.split("-").map(Number); return new Date(Date.UTC(year, value, 1)).toISOString().slice(0, 10); };
const monthOf = (iso: string): string => iso.slice(0, 7);

/** One record per month, from the newest resolution that sets it (a later resolution corrects an earlier one). */
export function areraCapacityRecords(tenantId: string, resolutions: readonly AreraCapacityResolution[], retrievedAt: string): readonly RegulatoryValueRecord[] {
  const byMonth = new Map<string, { readonly resolution: AreraCapacityResolution; readonly centsPerKwh: number }>();
  const ordered = [...resolutions].sort((left, right) => (right.publicationDate ?? "").localeCompare(left.publicationDate ?? "") || right.resolution.localeCompare(left.resolution, undefined, { numeric: true }));
  for (const resolution of ordered) for (const item of resolution.months) if (!byMonth.has(item.month)) byMonth.set(item.month, { resolution, centsPerKwh: item.centsPerKwh });
  return [...byMonth].sort(([left], [right]) => left.localeCompare(right)).map(([month, { resolution, centsPerKwh }]) => createRegulatoryValue({
    tenantId, sourceType: "OFFICIAL_PROVVEDIMENTO", sourceReference: resolution.url, officialIdentifier: `${resolution.resolution}:art.4.1:${month}`,
    publicationDate: resolution.publicationDate ?? retrievedAt.slice(0, 10), retrievedAt, effectiveFrom: `${month}-01`, effectiveTo: nextMonth(month),
    componentCode: "CAPACITY_MARKET", customerScope: "ALL_ELECTRICITY", originalValue: centsPerKwh, originalUnit: "CENT_EUR/KWH",
    applicationBasis: "corrispettivo capacità TIV commi 34.8, 41.9 e 48.9 (BT fino a 55 kW), al netto delle perdite TIS Tabella 4", sourceSha256: resolution.sourceSha256,
    officialName: "Corrispettivo mercato capacità (TIV art. 4.1)", contractPassThroughRequired: true,
  }));
}

export interface AreraCapacityRefreshSummary {
  readonly status: "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  readonly months: readonly { readonly month: string; readonly centsPerKwh: number; readonly resolution: string }[];
  readonly createdCount: number;
  readonly unchangedCount: number;
  readonly replacedCount: number;
  readonly errors: readonly string[];
}

/** Keeps the monthly ARERA capacity charge current: the month in force must be published by ARERA. */
export async function runAreraCapacityRefresh(input: { readonly tenantId: string; readonly capacitySourceReader?: AreraCapacitySourceReader } & RegulatoryRefreshDependencies): Promise<AreraCapacityRefreshSummary> {
  const now = new Date(input.now ?? new Date().toISOString()).toISOString();
  const runId = input.runId ?? `arera_cmc_${createHash("sha256").update(`${input.tenantId}|${input.trigger ?? "MANUAL"}|${now}`).digest("hex").slice(0, 36)}`;
  const reader = input.capacitySourceReader ?? createAreraCapacitySourceReader();
  let loaded: Awaited<ReturnType<AreraCapacitySourceReader["load"]>>;
  try { loaded = await reader.load({ retrievedAt: now }); }
  catch (error) { return { status: "FAILED", months: [], createdCount: 0, unchangedCount: 0, replacedCount: 0, errors: [error instanceof Error ? error.message : "ARERA_CAPACITY_SOURCE_FAILED"] }; }
  const errors = [...loaded.errors];
  const months: AreraCapacityRefreshSummary["months"][number][] = [];
  let createdCount = 0; let unchangedCount = 0; let replacedCount = 0;
  for (const record of areraCapacityRecords(input.tenantId, loaded.resolutions, now)) {
    try {
      const result = await applyRegulatoryRefreshCandidate(ARERA_CAPACITY_DOMAIN, record, input, input.tenantId, runId, now);
      createdCount += result.created; unchangedCount += result.unchanged; replacedCount += result.replaced;
      months.push({ month: monthOf(record.effectiveFrom), centsPerKwh: record.originalValue, resolution: record.officialIdentifier.split(":")[0] });
    } catch (error) { errors.push(`${monthOf(record.effectiveFrom)}:${error instanceof Error ? error.message : "ARERA_CAPACITY_SAVE_FAILED"}`); }
  }
  if (!months.some((item) => item.month === monthOf(now))) errors.push(`${monthOf(now)}:ARERA_CAPACITY_MONTH_NOT_FOUND`);
  const status = errors.length === 0 ? "SUCCESS" : months.length ? "PARTIAL_FAILURE" : "FAILED";
  return { status, months, createdCount, unchangedCount, replacedCount, errors };
}
