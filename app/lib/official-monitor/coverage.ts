import type { RegulatoryValueRecord } from "../foundation/regulatory-types";
import type { RegulatoryApprovalDomainState } from "../regulatory-approval-domain";
import type { MarketArchiveRecord } from "../market/types";
import { compareMarketVersions } from "../market/service";
import { isRetentionRetirement, operationalMarketMonths, romeToday } from "../market/operational-window";
import { ELECTRICITY_EXCISE_PERIODS } from "../calculation/electricity-taxes";
import { catalogEntry, type OfficialDocumentCode, type OfficialSource } from "./catalog";
import type { OfficialAlert, OfficialCheck } from "./monitor";
import type { OfficialPublicationRecord } from "./documents";

/**
 * Control Room Produttore → copertura reale degli archivi (Tony, 17/11/2026). Per ogni componente regolatoria e di mercato
 * dice quali periodi ci sono davvero, leggendo gli archivi esistenti con le stesse regole dei calcoli: un valore regolatorio
 * conta solo se è approvato nel suo dominio (come ProductionRegulatoryPersistenceBridge.list), un PUN solo se è APPROVED con
 * mensile unico e F1/F2/F3, la Tabella 5 solo se pubblicata, le accise dalla tabella del codice (electricityTaxes).
 * Quattro tipi di anomalia, separati: dati mancanti, presenti ma non aggiornati (si fermano prima del periodo atteso), non
 * verificati (presenti ma non approvati o di provenienza dichiarata) e copie aziendali divergenti. Gli alert sono calcolati a
 * ogni lettura e non scrivono nulla: nessuna tariffa, nessuna correzione degli archivi. Lo stato del monitoraggio (controlli
 * eseguiti) resta separato dalla copertura dei dati.
 */
export type CoverageAnomalyKind = "MISSING" | "STALE" | "UNVERIFIED" | "DIVERGENT";
/** OUTSIDE_WINDOW is only a notice (PUN/PSV approved for a month the calculations no longer read): never an anomaly. */
export type CoverageIssueKind = CoverageAnomalyKind | "OUTSIDE_WINDOW";
export type CoverageSeverity = "CRITICAL" | "WARNING" | "INFO";
export type CoverageStatus = "COMPLETE" | CoverageAnomalyKind;
const ANOMALY_KIND_LABEL: Readonly<Record<CoverageAnomalyKind, string>> = {
  MISSING: "Dati mancanti",
  STALE: "Presenti ma non aggiornati",
  UNVERIFIED: "Dati non verificati",
  DIVERGENT: "Copie aziendali divergenti",
};
export const COVERAGE_KIND_LABEL: Readonly<Record<CoverageIssueKind, string>> = { ...ANOMALY_KIND_LABEL, OUTSIDE_WINDOW: "Fuori dalla finestra operativa" };
export const COVERAGE_STATUS_LABEL: Readonly<Record<CoverageStatus, string>> = { COMPLETE: "Completo", ...ANOMALY_KIND_LABEL };
export const COVERAGE_SEVERITY_LABEL: Readonly<Record<CoverageSeverity, string>> = { CRITICAL: "Critica", WARNING: "Da verificare", INFO: "Informativa" };

/** One copy of the official data: the producer's archive (tenant_piattaforma) or a client company's copy used by its calculations. */
export interface CoverageCopy {
  readonly tenantId: string;
  readonly label: string;
  readonly platform: boolean;
  readonly regulatoryValues: readonly RegulatoryValueRecord[];
  readonly approvalDomains: readonly RegulatoryApprovalDomainState[];
  readonly marketArchives: readonly MarketArchiveRecord[];
}
export interface CoverageInput {
  readonly now: string;
  readonly copies: readonly CoverageCopy[];
  readonly publications: readonly OfficialPublicationRecord[];
  readonly checks: readonly OfficialCheck[];
  readonly alerts: readonly OfficialAlert[];
}

export interface CoverageIssue {
  readonly id: string;
  readonly kind: CoverageIssueKind;
  readonly kindLabel: string;
  readonly severity: CoverageSeverity;
  readonly severityLabel: string;
  readonly archive: OfficialSource;
  readonly component: string;
  readonly componentName: string;
  readonly source: string;
  readonly officialLink: string;
  readonly periods: readonly string[];
  readonly periodLabel: string;
  readonly copies: readonly string[];
  readonly detail: string;
  readonly action: string;
}
export interface ComponentCoverage {
  readonly key: string;
  readonly archive: OfficialSource;
  readonly name: string;
  readonly source: string;
  readonly officialLink: string;
  readonly expected: readonly string[];
  readonly expectedLabel: string;
  readonly lastAvailable: string | null;
  readonly missing: readonly string[];
  readonly missingLabel: string;
  readonly lastCheck: string | null;
  readonly lastData: string | null;
  readonly status: CoverageStatus;
  readonly statusLabel: string;
  readonly issues: readonly CoverageIssue[];
}
export interface ArchiveCoverage {
  readonly source: OfficialSource;
  readonly status: CoverageStatus;
  readonly statusLabel: string;
  readonly components: readonly ComponentCoverage[];
  readonly issues: number;
}
export interface CoverageReport {
  readonly generatedAt: string;
  readonly copies: readonly { readonly tenantId: string; readonly label: string; readonly platform: boolean }[];
  readonly archives: readonly ArchiveCoverage[];
  /** Centralised informative alerts, most severe first. Computed, never stored. */
  readonly alerts: readonly CoverageIssue[];
  readonly counts: Readonly<Record<CoverageAnomalyKind, number>>;
}

type Latest = "CURRENT_MONTH" | "PUBLISHED_MONTH" | "MARKET_WINDOW" | "YEAR";
interface ComponentDef {
  readonly key: string;
  readonly archive: OfficialSource;
  readonly name: string;
  readonly source: string;
  readonly monitorCode: OfficialDocumentCode;
  readonly latest: Latest;
  readonly read:
    | { readonly type: "REGULATORY"; readonly authority: "ARERA" | "TERNA"; readonly componentCode: string }
    | { readonly type: "MARKET"; readonly index: "PUN" | "PSV" }
    | { readonly type: "PUBLICATION"; readonly code: OfficialDocumentCode }
    | { readonly type: "EXCISE" };
  readonly action: string;
}

const REFRESH_ARERA = "Verifica sul sito ARERA la pubblicazione del periodo e rilancia l'aggiornamento da Stato sistema → Aggiorna dati ufficiali → fonte ARERA. Nessun valore si inserisce a mano.";
const REFRESH_TERNA = "Verifica sul sito Terna la pubblicazione del periodo e rilancia l'aggiornamento da Stato sistema → Aggiorna dati ufficiali → fonti Terna. Nessun valore si inserisce a mano.";
const regulatory = (archive: OfficialSource, authority: "ARERA" | "TERNA", componentCode: string, name: string, source: string, monitorCode: OfficialDocumentCode, action = authority === "TERNA" ? REFRESH_TERNA : REFRESH_ARERA): ComponentDef =>
  ({ key: `${authority}:${componentCode}`, archive, name, source, monitorCode, latest: "CURRENT_MONTH", read: { type: "REGULATORY", authority, componentCode }, action });

/** The components the simulator reads today, by archive. Each points to the catalog entry whose monitor checks it. */
export const COVERAGE_COMPONENTS: readonly ComponentDef[] = [
  regulatory("ARERA", "ARERA", "NETWORK_ENERGY", "Distribuzione, quota energia (TIT)", "ARERA, TIT", "ARERA_REGULATED_REFRESH"),
  regulatory("ARERA", "ARERA", "NETWORK_FIXED", "Distribuzione, quota fissa (TIT)", "ARERA, TIT", "ARERA_REGULATED_REFRESH"),
  regulatory("ARERA", "ARERA", "NETWORK_POWER", "Distribuzione, quota potenza (TIT)", "ARERA, TIT", "ARERA_REGULATED_REFRESH"),
  regulatory("ARERA", "ARERA", "TRANSMISSION_ENERGY", "Trasmissione (TIT)", "ARERA, TIT", "ARERA_REGULATED_REFRESH"),
  regulatory("ARERA", "ARERA", "METERING_FIXED", "Misura (TIME)", "ARERA, TIME", "ARERA_TIME_TABLES", "Scarica le tabelle TIME dal sito ARERA e caricale da Stato sistema → Azione richiesta: tabelle ARERA → Carica tabella."),
  regulatory("ARERA", "ARERA", "ARIM", "Oneri generali ARIM", "ARERA, oneri generali", "ARERA_REGULATED_REFRESH"),
  regulatory("ARERA", "ARERA", "ASOS", "Oneri generali ASOS", "ARERA, oneri generali", "ARERA_REGULATED_REFRESH"),
  regulatory("ARERA", "ARERA", "UC3", "Componente UC3", "ARERA, componenti UC", "ARERA_REGULATED_REFRESH"),
  regulatory("ARERA", "ARERA", "UC6", "Componente UC6", "ARERA, componenti UC", "ARERA_REGULATED_REFRESH"),
  regulatory("ARERA", "ARERA", "CAPACITY_MARKET", "Corrispettivo mercato della capacità (TIV)", "ARERA, TIV", "ARERA_REGULATED_REFRESH"),
  regulatory("ARERA", "ARERA", "DISPATCHING_TOTAL", "Dispacciamento (TIV)", "ARERA, TIV", "ARERA_REGULATED_REFRESH"),
  { key: "ARERA:TIT_TABLE5", archive: "ARERA", name: "Energia reattiva, TIT Tabella 5", source: "ARERA, TIT Tabella 5", monitorCode: "ARERA_TIT_TABLE5_REACTIVE", latest: "YEAR", read: { type: "PUBLICATION", code: "ARERA_TIT_TABLE5_REACTIVE" }, action: "Carica il file ufficiale in Control Room → Carica un nuovo documento e completa l'aggiornamento." },
  { key: "ARERA:PSV", archive: "ARERA", name: "PSV mensile (CMEM)", source: "ARERA, CMEM", monitorCode: "ARERA_REGULATED_REFRESH", latest: "MARKET_WINDOW", read: { type: "MARKET", index: "PSV" }, action: "Rilancia l'aggiornamento da Stato sistema → Aggiorna dati ufficiali → fonte PSV: il valore si legge solo da ARERA." },
  { key: "GME:PUN", archive: "GME", name: "PUN Index mensile unico e F1/F2/F3", source: "GME, Prezzo medio per fasce", monitorCode: "GME_PUN_MONTH", latest: "MARKET_WINDOW", read: { type: "MARKET", index: "PUN" }, action: "Se il GME ha pubblicato il mese, avvia l'aggiornamento da Stato sistema → Aggiorna dati ufficiali → fonte PUN (si legge solo dal GME). Per i mesi di una bolletta il simulatore prova anche a scaricarlo al momento della simulazione." },
  regulatory("TERNA", "TERNA", "DISPATCHING_TOTAL", "Dispacciamento (Terna)", "Terna, corrispettivi", "TERNA_DISPATCHING_CAPACITY"),
  regulatory("TERNA", "TERNA", "CAPACITY_MARKET_OFF_PEAK", "Capacità, fuori picco (Terna)", "Terna, corrispettivi", "TERNA_DISPATCHING_CAPACITY"),
  { key: "ADM:EXCISE", archive: "ADM", name: "Accise sull'energia elettrica", source: "ADM, D.Lgs. 504/1995 Allegato I", monitorCode: "ADM_EXCISE_RATES", latest: "YEAR", read: { type: "EXCISE" }, action: "Verifica sul portale ADM le aliquote dell'anno e conferma la verifica in Control Room; se sono cambiate va richiesto l'aggiornamento del calcolo." },
];

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const pad = (value: number) => String(value).padStart(2, "0");
const monthOf = (year: number, month: number) => `${year}-${pad(month)}`;
const addMonths = (period: string, delta: number) => { const [year, month] = period.split("-").map(Number); const index = year * 12 + (month - 1) + delta; return monthOf(Math.floor(index / 12), (index % 12) + 1); };
const monthRange = (from: string, to: string) => { const out: string[] = []; for (let current = from; current <= to; current = addMonths(current, 1)) out.push(current); return out; };
const monthName = (period: string) => { const [year, month] = period.split("-").map(Number); return `${MONTHS[month - 1]} ${year}`; };

/** "gennaio–giugno 2026, novembre 2026": consecutive months collapsed; years stay as they are. */
export function formatPeriods(periods: readonly string[]): string {
  if (periods.length === 0) return "nessuno";
  if (periods.every((period) => /^\d{4}$/.test(period))) return periods.join(", ");
  const sorted = [...new Set(periods)].sort(); const runs: string[][] = [];
  for (const period of sorted) { const last = runs.at(-1); if (last && addMonths(last.at(-1)!, 1) === period) last.push(period); else runs.push([period]); }
  return runs.map((run) => {
    if (run.length === 1) return monthName(run[0]);
    const [first, last] = [run[0], run.at(-1)!];
    return first.slice(0, 4) === last.slice(0, 4) ? `${MONTHS[Number(first.slice(5)) - 1]}–${monthName(last)}` : `${monthName(first)} – ${monthName(last)}`;
  }).join(", ");
}

/** Calendar of Italy for `now`; the expected window of a component. */
function expectedPeriods(latest: Latest, now: string): readonly string[] {
  const local = new Date(new Date(now).toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const year = local.getFullYear(); const month = local.getMonth() + 1; const day = local.getDate();
  if (latest === "YEAR") return month === 12 && day >= 15 ? [String(year), String(year + 1)] : [String(year)];
  // Tony (17/11/2026): PUN and PSV are expected only inside the six operational months the calculations read (the same
  // window as operationalMarketView); the previous month only from the 15th, after the GME check of the 5th–14th.
  if (latest === "MARKET_WINDOW") { const months = [...operationalMarketMonths(romeToday(new Date(now)))].reverse(); return day >= 15 ? months : months.slice(0, -1); }
  const current = monthOf(year, month);
  // Monthly indexes are published at the start of the following month: the GME check runs from the 5th to the 14th, so the
  // previous month is expected from the 15th; before that, the month before it.
  const last = latest === "CURRENT_MONTH" ? current : addMonths(current, day >= 15 ? -1 : -2);
  return last < `${year}-01` ? [last] : monthRange(`${year}-01`, last);
}

const covers = (from: string, to: string | null, period: string) => {
  const start = Date.parse(`${period}-01T00:00:00.000Z`);
  return Date.parse(from) <= start && (to === null || Date.parse(to) > start);
};
/** identityKey = tenant|documento sorgente|componente|cliente|decorrenza|unità: per confrontare le copie contano componente,
 * cliente, decorrenza, unità e valore, non il documento da cui il valore è stato letto (una rettifica dello stesso valore non diverge). */
const semanticKey = (identityKey: string) => identityKey.split("|").slice(2).join("|");
const round = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : "∅";

interface CopyReading {
  /** period → fingerprint of what the calculations would use, when usable. */
  readonly usable: ReadonlyMap<string, string>;
  /** periods with records that exist but are not usable (not approved, rejected, incomplete). */
  readonly unusable: ReadonlyMap<string, string>;
  readonly lastData: string | null;
}

function approvedTargets(domains: readonly RegulatoryApprovalDomainState[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const state of domains) for (const entry of state?.effectiveApprovals ?? []) if (entry?.targetRecordId && entry.targetRecordChecksum) out.add(`${entry.targetRecordId}|${entry.targetRecordChecksum.toLowerCase()}`);
  return out;
}

function readCopy(def: ComponentDef, copy: CoverageCopy, expected: readonly string[], approved: ReadonlySet<string>): CopyReading {
  const usable = new Map<string, string>(); const unusable = new Map<string, string>(); let lastData: string | null = null;
  const later = (value: string | null | undefined) => { if (value && (!lastData || value > lastData)) lastData = value; };
  if (def.read.type === "REGULATORY") {
    const { authority, componentCode } = def.read;
    const records = copy.regulatoryValues.filter((record) => record.authority === authority && record.componentCode === componentCode);
    for (const period of expected) {
      const covering = records.filter((record) => covers(record.effectiveFrom, record.effectiveTo, period));
      const ok = covering.filter((record) => approved.has(`${record.id}|${String(record.checksum).toLowerCase()}`));
      if (ok.length) { usable.set(period, ok.map((record) => `${semanticKey(record.identityKey)}=${round(record.normalizedValue)}`).sort().filter((print, index, all) => all.indexOf(print) === index).join(";")); ok.forEach((record) => later(record.retrievedAt)); }
      else if (covering.length) unusable.set(period, `${covering.length} valori presenti ma non approvati: non entrano nei calcoli`);
    }
  } else if (def.read.type === "MARKET") {
    const { index } = def.read;
    // Records retired by the retention rule are kept for audit only: they are neither missing nor unverified data.
    const records = copy.marketArchives.filter((record) => record.index === index && !isRetentionRetirement(record));
    for (const period of expected) {
      const month = records.filter((record) => record.month === period);
      const approvedRecords = month.filter((record) => record.status === "APPROVED").sort(compareMarketVersions);
      const value = approvedRecords[0]?.record as unknown as Readonly<Record<string, { readonly value?: unknown } | undefined>> | undefined;
      // The PSV record carries its monthly value in `value` (GasMonthlyPsvRecord), the PUN in `monthly` plus F1/F2/F3.
      const parts = index === "PUN" ? ["monthly", "f1", "f2", "f3"] : ["value"];
      const present = value ? parts.filter((part) => typeof value[part]?.value === "number") : [];
      if (value && present.length === parts.length) { usable.set(period, parts.map((part) => `${part}=${round(value[part]?.value)}`).join(";")); later(approvedRecords[0].updatedAt); }
      else if (value) unusable.set(period, `approvato senza ${parts.filter((part) => !present.includes(part)).map((part) => part === "monthly" ? "valore mensile unico" : part === "value" ? "valore mensile" : part.toUpperCase()).join(", ")}`);
      else if (month.length) unusable.set(period, `presente con stato ${[...new Set(month.map((record) => record.status))].join("/")}, non approvato`);
    }
  }
  return { usable, unusable, lastData };
}

const SEVERITY_ORDER: Readonly<Record<CoverageSeverity, number>> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
const KIND_ORDER: Readonly<Record<CoverageIssueKind, number>> = { MISSING: 0, STALE: 1, UNVERIFIED: 2, DIVERGENT: 3, OUTSIDE_WINDOW: 4 };

export function computeCoverage(input: CoverageInput): CoverageReport {
  const now = input.now;
  const copies = input.copies;
  const approvals = new Map(copies.map((copy) => [copy.tenantId, approvedTargets(copy.approvalDomains)]));
  const components: ComponentCoverage[] = [];
  for (const def of COVERAGE_COMPONENTS) {
    const entry = catalogEntry(def.monitorCode);
    const expected = expectedPeriods(def.latest, now);
    const issues: CoverageIssue[] = [];
    const issue = (kind: CoverageIssueKind, severity: CoverageSeverity, periods: readonly string[], copyLabels: readonly string[], detail: string, action = def.action) => issues.push({
      id: `${def.key}:${kind}:${periods.join(",")}:${copyLabels.join(",")}`, kind, kindLabel: COVERAGE_KIND_LABEL[kind], severity, severityLabel: COVERAGE_SEVERITY_LABEL[severity], archive: def.archive, component: def.key, componentName: def.name,
      source: def.source, officialLink: entry.officialLink, periods, periodLabel: formatPeriods(periods), copies: copyLabels, detail, action,
    });
    const lastCheck = input.checks.filter((check) => check.code === def.monitorCode).map((check) => check.at).sort().at(-1) ?? null;
    let lastAvailable: string | null = null; let lastData: string | null = null; let missingAll: string[] = [];

    if (def.read.type === "PUBLICATION") {
      const { code } = def.read;
      const published = input.publications.filter((item) => item.code === code);
      const years = new Set(published.map((item) => item.period));
      lastAvailable = [...years].sort().at(-1) ?? null;
      lastData = published.map((item) => item.publishedAt).sort().at(-1) ?? null;
      missingAll = expected.filter((year) => !years.has(year));
      if (missingAll.length) issue("MISSING", missingAll.includes(expected[0]) ? "CRITICAL" : "WARNING", missingAll, ["archivio centrale"], `nessuna versione pubblicata per ${formatPeriods(missingAll)}: il dato non è disponibile ai calcoli`);
      const acknowledged = expected.filter((year) => published.some((item) => item.period === year && item.provenanceAcknowledged) && !published.some((item) => item.period === year && !item.provenanceAcknowledged && item.provenanceLevel === "MATCHES_OFFICIAL_DOWNLOAD"));
      if (acknowledged.length) issue("UNVERIFIED", "INFO", acknowledged, ["archivio centrale"], "pubblicata con provenienza confermata dal produttore: il file non è identico a quello scaricato dalla fonte (non è un'autenticazione ARERA)", "Nessuna azione obbligatoria. Se ARERA pubblica il file in modo leggibile dal server, ricaricalo per avere la provenienza verificata.");
    } else if (def.read.type === "EXCISE") {
      const coveredYears = expected.filter((year) => ELECTRICITY_EXCISE_PERIODS.some((period) => covers(period.effectiveFrom, period.effectiveTo, `${year}-01`) && covers(period.effectiveFrom, period.effectiveTo, `${year}-12`)));
      lastAvailable = coveredYears.at(-1) ?? null;
      missingAll = expected.filter((year) => !coveredYears.includes(year));
      if (missingAll.length) issue("MISSING", "CRITICAL", missingAll, ["calcolo (tabella nel codice)"], `aliquote non presenti per ${formatPeriods(missingAll)}: accise e IVA risultano non determinabili`);
      const verified = (year: string) => input.alerts.some((alert) => alert.code === "ADM_EXCISE_RATES" && alert.period === year && alert.status === "RESOLVED");
      const unverified = coveredYears.filter((year) => !verified(year));
      if (unverified.length) issue("UNVERIFIED", "INFO", unverified, ["calcolo (tabella nel codice)"], "aliquote presenti nel codice del calcolo (non in un archivio); nessuna verifica ADM registrata per l'anno");
    } else {
      const readings = copies.map((copy) => ({ copy, reading: readCopy(def, copy, expected, approvals.get(copy.tenantId) ?? new Set()) }));
      for (const { reading } of readings) if (reading.lastData && (!lastData || reading.lastData > lastData)) lastData = reading.lastData;
      const usableAnywhere = expected.filter((period) => readings.some(({ reading }) => reading.usable.has(period)));
      lastAvailable = usableAnywhere.at(-1) ?? null;
      // Per copy: holes (missing), tail after the last usable period (stale), present but not usable (unverified).
      const group = new Map<string, { kind: CoverageIssueKind; periods: string[]; copies: string[]; company: boolean; detail: string }>();
      const add = (kind: CoverageIssueKind, periods: string[], copy: CoverageCopy, detail: string) => {
        if (!periods.length) return;
        const key = `${kind}|${periods.join(",")}|${detail}`;
        const current = group.get(key) ?? { kind, periods, copies: [], company: false, detail };
        current.copies.push(copy.label); current.company ||= !copy.platform; group.set(key, current);
      };
      const missingEverywhere = new Set(expected);
      for (const { copy, reading } of readings) {
        const notUsable = expected.filter((period) => !reading.usable.has(period));
        for (const period of expected) if (reading.usable.has(period)) missingEverywhere.delete(period);
        const lastUsable = expected.filter((period) => reading.usable.has(period)).at(-1);
        const unverified = notUsable.filter((period) => reading.unusable.has(period));
        const absent = notUsable.filter((period) => !reading.unusable.has(period));
        const stale = lastUsable ? absent.filter((period) => period > lastUsable) : [];
        const holes = absent.filter((period) => !stale.includes(period));
        add("MISSING", holes, copy, lastUsable ? "nessun valore utilizzabile per questi periodi" : "nessun valore utilizzabile nel periodo atteso");
        add("STALE", stale, copy, `i dati si fermano a ${monthName(lastUsable ?? expected[0])}`);
        const reasons = [...new Set(unverified.map((period) => reading.unusable.get(period)!))];
        add("UNVERIFIED", unverified, copy, reasons.join("; "));
      }
      for (const item of group.values()) issue(item.kind, item.kind === "UNVERIFIED" ? "WARNING" : item.company || item.periods.includes(expected.at(-1)!) ? "CRITICAL" : "WARNING", item.periods, item.copies, item.detail);
      missingAll = [...missingEverywhere];
      // Divergences between copies: a period usable in some copies and not in others, or with different values.
      if (readings.length > 1) {
        const presence = expected.filter((period) => { const has = readings.filter(({ reading }) => reading.usable.has(period)).length; return has > 0 && has < readings.length; });
        if (presence.length) {
          const holders = [...new Set(readings.filter(({ reading }) => presence.some((period) => reading.usable.has(period))).map(({ copy }) => copy.label))];
          issue("DIVERGENT", "WARNING", presence, readings.map(({ copy }) => copy.label), `periodi presenti solo in: ${holders.join(", ")}`, "Rilancia l'aggiornamento ufficiale per tutte le aziende e controlla che le copie coincidano. Nessuna correzione automatica.");
        }
        const values = expected.filter((period) => { const prints = readings.map(({ reading }) => reading.usable.get(period)).filter((print): print is string => Boolean(print)); return prints.length > 1 && new Set(prints).size > 1; });
        if (values.length) issue("DIVERGENT", "WARNING", values, readings.map(({ copy }) => copy.label), "le copie hanno valori o voci diverse per gli stessi periodi", "Confronta le copie con la fonte ufficiale e rilancia l'aggiornamento per tutte le aziende. Nessuna correzione automatica.");
      }
    }
    if (def.read.type === "MARKET" && def.latest === "MARKET_WINDOW") {
      // PUN/PSV still approved for a month older than the window: the calculations already ignore it; the next refresh retires it.
      const { index } = def.read;
      const oldest = operationalMarketMonths(romeToday(new Date(now))).at(-1)!;
      const stale = copies.map((copy) => ({ copy, months: [...new Set(copy.marketArchives.filter((record) => record.index === index && record.status === "APPROVED" && record.month < oldest).map((record) => record.month))].sort() })).filter((item) => item.months.length);
      const periods = [...new Set(stale.flatMap((item) => item.months))].sort();
      if (periods.length) issue("OUTSIDE_WINDOW", "INFO", periods, stale.map((item) => item.copy.label), "approvati ma fuori dai sei mesi operativi: i calcoli non li usano già; restano in archivio finché il prossimo aggiornamento non li ritira (storico e audit conservati)", "Nessuna azione obbligatoria. Il ritiro avviene al prossimo aggiornamento PUN/PSV; nessun dato viene cancellato.");
    }
    const anomalies = issues.filter((item) => item.kind !== "OUTSIDE_WINDOW");
    const worst = [...anomalies].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])[0];
    const status: CoverageStatus = worst ? worst.kind as CoverageAnomalyKind : "COMPLETE";
    components.push({
      key: def.key, archive: def.archive, name: def.name, source: def.source, officialLink: entry.officialLink, expected, expectedLabel: formatPeriods(expected), lastAvailable,
      missing: missingAll, missingLabel: missingAll.length ? formatPeriods(missingAll) : "nessuno", lastCheck, lastData, status, statusLabel: COVERAGE_STATUS_LABEL[status], issues,
    });
  }
  const alerts = components.flatMap((component) => component.issues).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.archive.localeCompare(b.archive));
  const archives = (["ARERA", "GME", "TERNA", "ADM"] as const).map((source) => {
    const own = components.filter((component) => component.archive === source);
    const worst = own.flatMap((component) => component.issues).filter((item) => item.kind !== "OUTSIDE_WINDOW").sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])[0];
    const status: CoverageStatus = worst ? worst.kind as CoverageAnomalyKind : "COMPLETE";
    return { source, status, statusLabel: COVERAGE_STATUS_LABEL[status], components: own, issues: own.reduce((sum, component) => sum + component.issues.filter((item) => item.kind !== "OUTSIDE_WINDOW").length, 0) };
  });
  const counts = { MISSING: 0, STALE: 0, UNVERIFIED: 0, DIVERGENT: 0 } as Record<CoverageAnomalyKind, number>;
  for (const alert of alerts) if (alert.kind !== "OUTSIDE_WINDOW") counts[alert.kind] += 1;
  return { generatedAt: now, copies: copies.map(({ tenantId, label, platform }) => ({ tenantId, label, platform })), archives, alerts, counts };
}
