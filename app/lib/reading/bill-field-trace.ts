import type { StructuredBillExtraction, StructuredBillField } from "../ingestion/structured-bill.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { customerTypeOf } from "../ingestion/customer-type.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { ANNUAL_ESTIMATE_LABEL, resolveAnnualConsumption } from "../calculation/annual-consumption.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { italianNumber, BANDS_SUM_TOLERANCE_KWH } from "./bill-reader-checks.ts";

// Tony (25/11/2026, attività 01 "Affidabilità della lettura bollette"): every field the simulation rests on says where it comes
// from (LETTO, CALCOLATO, STIMATO, ASSENTE) and, apart from that, how far it can be trusted: a value read from the bill can still
// be wrong or incoherent. Absent is never zero: a documented zero, an absent value, a value that does not apply to this supply
// and a value printed but not interpretable are four different things. The indispensable fields that are not verified stop
// definitive proposals; uncertain data are named. Nothing here reads the PDF again or changes a value: the trace is computed
// from the stored reading (also of bills read before today) and the operator's confirmations, and no economic formula is used.

export type TraceProvenance = "LETTO" | "CALCOLATO" | "STIMATO" | "ASSENTE";
export type TracePresence = "DOCUMENTATO" | "ZERO_DOCUMENTATO" | "ASSENTE" | "NON_APPLICABILE" | "NON_INTERPRETABILE";
/** VERIFICATO_OPERATORE: confirmed or corrected by the operator; COERENTE: the automatic checks on it pass; DA_VERIFICARE: read or
 *  estimated without a check that can confirm it; INCOERENTE: a check on it fails; NON_VALUTABILE: there is no value. */
export type TraceReliability = "VERIFICATO_OPERATORE" | "COERENTE" | "DA_VERIFICARE" | "INCOERENTE" | "NON_VALUTABILE";
export type TraceMethod = "LETTURA_AI" | "CORREZIONE_UTENTE" | "FORMULA" | "STIMA" | "NESSUNO";
/** BLOCCANTE: stops definitive proposals; DA_CONFERMARE: stops them until the operator confirms the field it names (none named:
 *  until the bill is read again); AVVISO: shown, does not stop; INFO: how a value was obtained. */
export type TraceSeverity = "BLOCCANTE" | "DA_CONFERMARE" | "AVVISO" | "INFO";
/** The fields of the bill the operator confirms before approval (same names as BillFields in foundation/real-bill.ts). */
export type ConfirmableField = "supplier" | "pod" | "customerName" | "billingPeriod" | "annualConsumption" | "billedConsumption" | "totalAmount";

export interface TracedField {
  readonly key: string;
  readonly label: string;
  /** The value as shown ("" when absent); never a number made up for an absent value. */
  readonly value: string;
  readonly provenance: TraceProvenance;
  readonly presence: TracePresence;
  readonly reliability: TraceReliability;
  readonly method: TraceMethod;
  readonly indispensable: boolean;
  /** PDF page the reader copied it from, when it said so. */
  readonly page: number | null;
  /** How a CALCOLATO or STIMATO value was obtained, or why an absent one is absent. */
  readonly note: string | null;
  readonly checks: readonly string[];
  /** The printed rows a value was read from, when it comes from several (e.g. the same kW in the scontrino and in the detail). */
  readonly sources?: readonly TraceSource[];
}

/** One printed row behind a traced value: its text as printed, where it is and the period it refers to. */
export interface TraceSource {
  readonly text: string;
  readonly row: string;
  readonly origin: "SCONTRINO" | "DETTAGLIO";
  /** Known for the scontrino rows; the detail rows do not carry their page. */
  readonly page: number | null;
  readonly period: string;
}

export interface TraceIssue {
  readonly code: string;
  readonly severity: TraceSeverity;
  readonly field: string;
  readonly message: string;
  /** The field whose confirmation by the operator resolves a DA_CONFERMARE issue; null when only a new reading can. */
  readonly confirmField: ConfirmableField | null;
}

export interface BillFieldTrace {
  readonly traceVersion: 1;
  readonly vector: "EE" | "GAS" | "UNKNOWN";
  /** False for bills stored without the structured reading: only the confirmed fields can be traced. */
  readonly structuredReading: boolean;
  /** True when the reader read the bill a second time because the first reading did not add up; null when not recorded. */
  readonly reread: boolean | null;
  readonly fields: readonly TracedField[];
  readonly issues: readonly TraceIssue[];
  /** The issues that stop a definitive proposal now (BLOCCANTE, and DA_CONFERMARE not yet confirmed). */
  readonly openIssues: readonly TraceIssue[];
  /** Labels of the indispensable fields that are estimated, calculated without the operator's confirmation, or incoherent. */
  readonly uncertainFields: readonly string[];
  readonly definitiveAllowed: boolean;
}

type ConfirmedFields = Readonly<Partial<Record<ConfirmableField, { readonly value: string | null; readonly source: string; readonly confirmed: boolean }>>>;
export interface BillFieldTraceInput {
  readonly structuredBill: StructuredBillExtraction | null | undefined;
  readonly fields: ConfirmedFields;
  readonly vector?: "EE" | "GAS" | "UNKNOWN";
}

const POD_STRICT = /^IT\d{3}E\d{8,9}$/;
const POD_SHAPE = /^IT\d{3}E[0-9A-Z]{8,9}$/;
const PDR_FORMAT = /^\d{14}$/;
/** A kW quantity as a plain number ("13,4", "22", "0", "16.5"), optionally followed by its unit; anything else is not interpretable. */
const PLAIN_KW_QUANTITY = /^\d+(?:[.,]\d+)?(?:\s*kW)?$/i;
const VAT_NUMBER = /^\d{11}$/;
const TAX_CODE = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
const DAY = 86_400_000;

const kwh = (value: number) => `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(value)} kWh`;

interface Context {
  readonly bill: StructuredBillExtraction | null;
  readonly fields: ConfirmedFields;
  readonly issues: TraceIssue[];
}

function issue(context: Context, code: string, severity: TraceSeverity, field: string, message: string, confirmField: ConfirmableField | null = null): void {
  context.issues.push({ code, severity, field, message, confirmField });
}

function pageOf(bill: StructuredBillExtraction | null, names: readonly string[]): number | null {
  const source = bill?.readingSources?.find((item) => names.includes(item.field) && Number.isInteger(item.page) && item.page > 0);
  return source ? source.page : null;
}
function absentReason(bill: StructuredBillExtraction | null, names: readonly string[]): string | null {
  return bill?.readingAbsent?.find((item) => names.includes(item.field))?.reason?.trim() || null;
}
function uninterpretable(bill: StructuredBillExtraction | null, names: readonly string[]): string | null {
  return bill?.readingUninterpretable?.find((item) => names.includes(item.field))?.text ?? null;
}
function derived(bill: StructuredBillExtraction | null, names: readonly string[]): string | null {
  return bill?.readingDerived?.find((item) => names.includes(item.field))?.method ?? null;
}

interface Raw { readonly present: boolean; readonly value: string; readonly number: number | null; readonly unreadable: boolean; readonly corrected: boolean }

/** A structured field as read: present with its text, or absent, or printed but not interpretable. */
function rawOf<T>(field: StructuredBillField<T> | undefined, show: (value: T) => string = (value) => String(value)): Raw {
  if (!field || field.value === null || field.value === undefined) return { present: false, value: "", number: null, unreadable: field?.status === "INVALID", corrected: false };
  const text = show(field.value);
  if (field.status === "INVALID" || field.status === "NEEDS_REVIEW" || /^(UNKNOWN|NOT_FOUND)$/.test(text)) return { present: false, value: "", number: null, unreadable: true, corrected: false };
  if (field.status !== "FOUND") return { present: false, value: "", number: null, unreadable: false, corrected: false };
  return { present: true, value: text, number: typeof field.value === "number" ? field.value : null, unreadable: false, corrected: field.source === "HUMAN_CORRECTION" };
}

function factRaw(bill: StructuredBillExtraction | null, code: string): Raw {
  const fact = bill?.extendedFacts?.find((item) => item.code === code);
  if (!fact) return { present: false, value: "", number: null, unreadable: false, corrected: false };
  const text = String(fact.value ?? "").trim();
  if (fact.status !== "FOUND" || !text || /^NOT_FOUND$/i.test(text)) return { present: false, value: "", number: null, unreadable: fact.status === "INVALID" || fact.status === "NEEDS_REVIEW", corrected: false };
  return { present: true, value: withUnit(text, fact.unit), number: italianNumber(text), unreadable: false, corrected: false };
}

// Tony (27/11/2026, Versace Elios: «0,012 €/kWh EUR/KWH»): the unit is shown once. When the printed value already carries
// it, nothing is added; otherwise the stored unit ("EUR/KWH", normalised by the reader) is shown in its readable form. Display
// only: the value and its number stay as read.
const PRINTED_UNIT = /€|\beur\b|kwh|\bkw\b|smc|\/\s*(?:mese|giorno|anno|pod)\b|%/i;
function readableUnit(unit: string): string {
  return unit.trim().replace(/^EUR\s*\//i, "€/").replace(/\bEUR\b/gi, "€").replace(/kwh/gi, "kWh").replace(/\bkw\b/gi, "kW").replace(/smc/gi, "Smc").replace(/\bMESE\b/g, "mese");
}
function withUnit(text: string, unit: string | null | undefined): string {
  if (!unit?.trim() || PRINTED_UNIT.test(text)) return text;
  return `${text} ${readableUnit(unit)}`;
}

// Tony (27/11/2026, Versace Elios: «3 kW, 3,0 kW»): kW quantities that are the same number for the same period are one value,
// shown once, with every printed row kept as a source (scontrino or detail, page, period). Different numbers, or the same number
// for different periods, stay distinct. The rows themselves are not touched: this groups only what is shown.
interface KwGroup { readonly number: number; readonly period: string; readonly sources: TraceSource[] }
const SCONTRINO_EVIDENCE = /^pagina\s+(\d+)$/i;
function kwSource(line: StructuredBillExtraction["economicChargeLines"][number]): TraceSource {
  const page = SCONTRINO_EVIDENCE.exec((line.documentEvidence ?? "").trim());
  return { text: line.quantity.trim(), row: (line.rawDescription ?? line.description).trim(), origin: page ? "SCONTRINO" : "DETTAGLIO", page: page ? Number(page[1]) : null, period: (line.periodRaw ?? "").trim() };
}
function kwGroups(lines: readonly StructuredBillExtraction["economicChargeLines"][number][]): KwGroup[] {
  const groups: KwGroup[] = [];
  const dated = lines.filter((line) => (line.periodRaw ?? "").trim());
  for (const line of [...dated, ...lines.filter((item) => !dated.includes(item))]) {
    const source = kwSource(line);
    const number = italianNumber(source.text.replace(/\s*kW$/i, ""));
    if (number === null) continue;
    // A row without a period joins the same number whatever its period; a dated row joins only the same number and period.
    const group = groups.find((item) => item.number === number && (!source.period || item.period === source.period));
    if (group) group.sources.push(source);
    else groups.push({ number, period: source.period, sources: [source] });
  }
  return groups;
}
function sourceText(source: TraceSource): string {
  return `«${source.text}» ${source.origin === "SCONTRINO" ? "scontrino" : "dettaglio"}${source.page ? ` pag. ${source.page}` : ""}${source.period ? ` (${source.period})` : ""}: ${source.row}`;
}

/** The field as the operator left it, when the bill has no structured reading (stored before it existed). */
function confirmedRaw(fields: ConfirmedFields, name: ConfirmableField): Raw {
  const field = fields[name];
  const text = field?.value?.trim() ?? "";
  return text ? { present: true, value: text, number: italianNumber(text), unreadable: false, corrected: field?.source === "manual" } : { present: false, value: "", number: null, unreadable: false, corrected: false };
}

interface Spec {
  readonly key: string;
  readonly label: string;
  /** Names the reader uses for this field in its sources and absences (bill-reader-schema.ts). */
  readonly names: readonly string[];
  readonly indispensable: boolean;
  readonly confirm?: ConfirmableField;
  readonly applicable?: boolean;
  /** True when an automatic check could confirm the value (another value of the bill to compare it with). */
  readonly checked?: boolean;
}

function traced(context: Context, spec: Spec, raw: Raw, options: { readonly provenance?: TraceProvenance; readonly method?: TraceMethod; readonly note?: string | null } = {}): TracedField {
  const { bill, fields } = context;
  const checks = context.issues.filter((item) => item.field === spec.key);
  const confirmed = spec.confirm ? fields[spec.confirm] : undefined;
  const operator = Boolean(confirmed?.confirmed) || raw.corrected || confirmed?.source === "manual";
  if (spec.applicable === false) {
    return { key: spec.key, label: spec.label, value: "", provenance: "ASSENTE", presence: "NON_APPLICABILE", reliability: "NON_VALUTABILE", method: "NESSUNO", indispensable: false, page: null, note: null, checks: [] };
  }
  if (!raw.present) {
    const printed = uninterpretable(bill, spec.names);
    const unreadable = raw.unreadable || printed !== null;
    return {
      key: spec.key, label: spec.label, value: "", provenance: "ASSENTE", presence: unreadable ? "NON_INTERPRETABILE" : "ASSENTE", reliability: "NON_VALUTABILE", method: "NESSUNO",
      indispensable: spec.indispensable, page: pageOf(bill, spec.names),
      note: options.note ?? (unreadable ? `stampato ma non interpretabile${printed ? `: «${printed}»` : ""}` : absentReason(bill, spec.names)),
      checks: checks.map((item) => item.code),
    };
  }
  const derivation = derived(bill, spec.names);
  const provenance: TraceProvenance = options.provenance ?? (derivation && !raw.corrected ? "CALCOLATO" : "LETTO");
  const method: TraceMethod = raw.corrected || (confirmed?.source === "manual") ? "CORREZIONE_UTENTE" : options.method ?? (provenance === "CALCOLATO" ? "FORMULA" : provenance === "STIMATO" ? "STIMA" : "LETTURA_AI");
  const failing = checks.filter((item) => item.severity === "BLOCCANTE" || item.severity === "DA_CONFERMARE");
  const reliability: TraceReliability = failing.some((item) => item.severity === "BLOCCANTE" || !operator) ? "INCOERENTE"
    : operator ? "VERIFICATO_OPERATORE"
    : provenance === "STIMATO" || checks.some((item) => item.severity === "AVVISO") ? "DA_VERIFICARE"
    : spec.checked ? "COERENTE" : "DA_VERIFICARE";
  return {
    key: spec.key, label: spec.label, value: raw.value, provenance,
    presence: raw.number === 0 ? "ZERO_DOCUMENTATO" : "DOCUMENTATO",
    reliability, method, indispensable: spec.indispensable, page: pageOf(bill, spec.names),
    note: options.note ?? (derivation ? DERIVATION_TEXT[derivation] ?? derivation : null),
    checks: checks.map((item) => item.code),
  };
}

const DERIVATION_TEXT: Readonly<Record<string, string>> = {
  SOMMA_FASCE: "consumo del periodo = F1 + F2 + F3 letti (il totale non è stampato o è illeggibile)",
  QUOTA_CONSUMI_SCONTRINO: "consumo del periodo = quantità della quota per consumi dello scontrino",
};

// Stored reading checks (text) → the field they concern. BANDS_SUM is computed again here, so its message is not mapped twice.
const STORED_CHECKS: readonly { readonly pattern: RegExp; readonly code: string; readonly field: string; readonly severity: TraceSeverity; readonly confirm: ConfirmableField | null }[] = [
  { pattern: /^Il documento non sembra una bolletta/, code: "NOT_A_BILL", field: "documento", severity: "BLOCCANTE", confirm: null },
  // F1 + F2 + F3 against the printed total, as checked when read: kept also when the stored total is the bands' sum.
  { pattern: /^F1 .* non dà il consumo fatturato/, code: "BANDS_SUM", field: "consumoTotale", severity: "DA_CONFERMARE", confirm: "billedConsumption" },
  { pattern: /^Consumo fatturato \((kWh|Smc)\) non letto/, code: "CONSUMPTION_MISSING", field: "", severity: "INFO", confirm: null },
  { pattern: /^Consumo fatturato stampato pari a zero/, code: "CONSUMPTION_ZERO_CHECK", field: "", severity: "INFO", confirm: null },
  { pattern: /^Periodo fatturato non letto/, code: "PERIOD_MISSING", field: "", severity: "INFO", confirm: null },
  { pattern: /^Totale bolletta non letto/, code: "TOTAL_MISSING", field: "", severity: "INFO", confirm: null },
  { pattern: /quota per consumi dello scontrino stampa .* ma il consumo fatturato letto/, code: "CONSUMPTION_VS_SCONTRINO", field: "consumoTotale", severity: "DA_CONFERMARE", confirm: "billedConsumption" },
  { pattern: /^Le righe dello scontrino sommano/, code: "SCONTRINO_TOTAL", field: "totaleBolletta", severity: "DA_CONFERMARE", confirm: "totalAmount" },
  { pattern: /^Il totale bolletta letto .* è diverso da quello dello scontrino/, code: "TOTAL_MISMATCH", field: "totaleBolletta", severity: "DA_CONFERMARE", confirm: "totalAmount" },
  { pattern: /^Quota [a-z]+: i 'di cui' sommano/, code: "QUOTA_SHARES", field: "componentiEconomiche", severity: "AVVISO", confirm: null },
  { pattern: /^Scontrino dell'energia \(quadro sintetico\) non letto/, code: "SCONTRINO_MISSING", field: "componentiEconomiche", severity: "AVVISO", confirm: null },
];

function storedChecks(context: Context): void {
  for (const message of context.bill?.readingChecks ?? []) {
    const known = STORED_CHECKS.find((item) => item.pattern.test(message));
    // Checks recomputed below from the stored values (bands, missing consumption, period, total) are not repeated.
    if (known && !known.field) continue;
    if (known) { issue(context, known.code, known.severity, known.field, message, known.confirm); continue; }
    // Quantity × price, printed components and every other check of the economic lines: shown, they do not stop the proposal
    // (the comparison reads the scontrino and the regulated values, not these lines).
    issue(context, "READING_CHECK", "AVVISO", "componentiEconomiche", message);
  }
}

function period(bill: StructuredBillExtraction | null, fields: ConfirmedFields): { readonly raw: Raw; readonly from: string | null; readonly to: string | null } {
  const field = bill?.billingPeriod;
  if (field && field.value && field.status === "FOUND") {
    const { from, to } = field.value;
    return { raw: { present: true, value: `${from} – ${to}`, number: null, unreadable: false, corrected: field.source === "HUMAN_CORRECTION" }, from, to };
  }
  const confirmed = confirmedRaw(fields, "billingPeriod");
  const match = /(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/.exec(confirmed.value);
  if (match) return { raw: confirmed, from: match[1], to: match[2] };
  return { raw: bill ? rawOf(field, () => "") : confirmed, from: null, to: null };
}

/** The trace of a stored bill version: each field with provenance, presence and reliability, the issues and whether a definitive
 *  proposal may rest on it. Deterministic: the same stored version gives the same trace. */
export function traceBillFields(input: BillFieldTraceInput): BillFieldTrace {
  const bill = input.structuredBill ?? null;
  const fields = input.fields;
  const vector: "EE" | "GAS" | "UNKNOWN" = input.vector && input.vector !== "UNKNOWN" ? input.vector : bill?.vector?.status === "FOUND" && bill.vector.value ? bill.vector.value : input.vector ?? "UNKNOWN";
  const context: Context = { bill, fields, issues: [] };
  const out: TracedField[] = [];
  const legacy = bill === null;
  const pick = <T>(field: StructuredBillField<T> | undefined, name: ConfirmableField, show?: (value: T) => string): Raw => legacy ? confirmedRaw(fields, name) : rawOf(field, show);

  if (!legacy) storedChecks(context);
  else issue(context, "LEGACY_READING", "AVVISO", "documento", "Bolletta letta prima della lettura strutturata: sono tracciabili solo i campi confermati; per gli altri controlli va riletta.");

  // Holder and tax identifier.
  const holder = pick(bill?.customerName, "customerName");
  if (!holder.present) issue(context, "HOLDER_MISSING", "BLOCCANTE", "intestatario", "Intestatario non letto: è indispensabile per la proposta.");
  out.push(traced(context, { key: "intestatario", label: "Intestatario", names: ["intestatario"], indispensable: true, confirm: "customerName" }, holder));
  const tax = legacy ? { present: false, value: "", number: null, unreadable: false, corrected: false } : rawOf(bill?.customerTaxIdentifier);
  const taxText = tax.value.replace(/\s/g, "").toUpperCase().replace(/^IT(?=\d{11}$)/, "");
  if (tax.present && !VAT_NUMBER.test(taxText) && !TAX_CODE.test(taxText)) issue(context, "TAX_ID_FORMAT", "AVVISO", "codiceFiscalePartitaIva", `Codice fiscale o partita IVA «${tax.value}» non ha la forma attesa (16 caratteri o 11 cifre): verifica la lettura.`);
  out.push(traced(context, { key: "codiceFiscalePartitaIva", label: "Codice fiscale / Partita IVA", names: ["codiceFiscalePartitaIva"], indispensable: false, checked: tax.present }, tax));

  // Supplier.
  const supplier = pick(bill?.supplier, "supplier");
  if (!supplier.present) issue(context, "SUPPLIER_MISSING", "BLOCCANTE", "fornitore", "Fornitore attuale non letto.");
  out.push(traced(context, { key: "fornitore", label: "Fornitore", names: ["fornitore"], indispensable: true, confirm: "supplier" }, supplier));

  // POD (electricity) or PDR (gas): the other one does not apply.
  const isGas = vector === "GAS";
  const supplyRaw = legacy ? confirmedRaw(fields, "pod") : rawOf(isGas ? bill?.pdr : bill?.pod);
  const supplyKey = isGas ? "pdr" : "pod";
  const code = supplyRaw.value.replace(/\s/g, "").toUpperCase();
  if (vector === "UNKNOWN" && !legacy) issue(context, "VECTOR_UNKNOWN", "BLOCCANTE", "pod", "Non è stato possibile stabilire se la bolletta è di energia elettrica o gas.");
  if (!supplyRaw.present) issue(context, isGas ? "PDR_MISSING" : "POD_MISSING", "BLOCCANTE", supplyKey, isGas ? "PDR non letto." : "POD non letto.");
  else if (isGas && !PDR_FORMAT.test(code)) issue(context, "PDR_FORMAT", "BLOCCANTE", supplyKey, `PDR «${supplyRaw.value}» non valido: deve avere 14 cifre.`);
  else if (!isGas && !POD_SHAPE.test(code)) issue(context, "POD_FORMAT", "BLOCCANTE", supplyKey, `POD «${supplyRaw.value}» non valido: deve essere IT, 3 cifre del distributore, E e 8 cifre (es. IT001E12345678).`);
  else if (!isGas && !POD_STRICT.test(code)) issue(context, "POD_AMBIGUOUS", "DA_CONFERMARE", supplyKey, `POD «${supplyRaw.value}» contiene lettere dove di norma ci sono cifre (lettura ambigua, es. O/0, I/1): confrontalo con la bolletta.`, "pod");
  out.push(traced(context, { key: supplyKey, label: isGas ? "PDR" : "POD", names: [supplyKey], indispensable: true, confirm: "pod", checked: true }, supplyRaw));
  if (!legacy) out.push(traced(context, { key: isGas ? "pod" : "pdr", label: isGas ? "POD" : "PDR", names: [], indispensable: false, applicable: false }, supplyRaw));

  // Customer type (domestic / business) and use: read, derived from the printed use, or estimated from the tax code.
  if (!legacy) {
    const readType = rawOf(bill!.customerType);
    const useText = factRaw(bill, "SUPPLY_USE_CATEGORY_RAW");
    const resolved = customerTypeOf(bill!);
    const label = (value: string | null) => value === "RESIDENTIAL" ? "Domestico" : value === "NON_RESIDENTIAL" ? "Non domestico (business)" : "";
    const useDomestic = /domestic/i.test(useText.value) && !/non\s*domestic|altri\s+usi/i.test(useText.value);
    const useBusiness = /non\s*domestic|altri\s+usi|illuminazione\s+pubblica|\bBTA\d?\b/i.test(useText.value);
    let typeRaw: Raw = { present: Boolean(resolved), value: label(resolved), number: null, unreadable: readType.unreadable && !resolved, corrected: readType.corrected };
    let provenance: TraceProvenance = "LETTO"; let note: string | null = null;
    if (!resolved) issue(context, "CUSTOMER_TYPE_UNKNOWN", "BLOCCANTE", "tipoCliente", "Tipo cliente (domestico o business) non determinabile dalla bolletta.");
    else if (!readType.present && useText.present) { provenance = "CALCOLATO"; note = `dalla tipologia stampata «${useText.value}»`; }
    else if (!readType.present) {
      provenance = "STIMATO"; note = "dedotto solo dal codice fiscale / partita IVA dell'intestatario";
      issue(context, "CUSTOMER_TYPE_ESTIMATED", "DA_CONFERMARE", "tipoCliente", `Tipo cliente ${label(resolved).toLowerCase()} dedotto solo dal codice fiscale o dalla partita IVA: la bolletta non lo stampa. Rileggi la bolletta o verifica la tipologia di fornitura.`);
    } else if (readType.value !== resolved) { provenance = "CALCOLATO"; note = `letto «${label(readType.value)}», ma la tipologia stampata «${useText.value}» indica un uso domestico`; }
    else if ((resolved === "RESIDENTIAL" && useBusiness) || (resolved === "NON_RESIDENTIAL" && useDomestic)) {
      issue(context, "CUSTOMER_TYPE_CONFLICT", "DA_CONFERMARE", "tipoCliente", `Tipo cliente letto «${label(resolved)}» in contrasto con la tipologia stampata «${useText.value}»: rileggi la bolletta.`);
    }
    if (!resolved) typeRaw = { ...typeRaw, present: false };
    out.push(traced(context, { key: "tipoCliente", label: "Tipo cliente", names: ["tipoCliente", "tipoClienteStampato"], indispensable: true, checked: useText.present }, typeRaw, { provenance, note }));
    out.push(traced(context, { key: "destinazioneUso", label: "Tipologia / destinazione d'uso", names: ["tipoClienteStampato"], indispensable: false }, useText));
    if (vector === "EE" && resolved === "RESIDENTIAL") {
      const residence = bill!.supplyProfile?.domesticResidenceStatus;
      const status = residence?.normalizedValue;
      const residenceRaw: Raw = status === "RESIDENT" || status === "NON_RESIDENT" ? { present: true, value: status === "RESIDENT" ? "Residente" : "Non residente", number: null, unreadable: false, corrected: false } : { present: false, value: "", number: null, unreadable: false, corrected: false };
      if (!residenceRaw.present) issue(context, "RESIDENCE_UNKNOWN", "AVVISO", "residenza", "Cliente domestico: residenza non indicata in bolletta. Le componenti che dipendono dalla residenza non sono determinabili e il confronto lo segnala.");
      out.push(traced(context, { key: "residenza", label: "Residenza (domestico)", names: ["tipoClienteStampato"], indispensable: false }, residenceRaw));
    }
  }

  // Billing period.
  const billing = period(bill, fields);
  if (!billing.raw.present && billing.raw.unreadable) issue(context, "PERIOD_INVALID", "BLOCCANTE", "periodo", "Periodo fatturato letto ma non valido (date incomplete o fine prima dell'inizio): confrontalo con la bolletta.");
  else if (!billing.raw.present) issue(context, "PERIOD_MISSING", "BLOCCANTE", "periodo", "Periodo fatturato non letto.");
  else if (billing.from && billing.to) {
    const days = (Date.parse(`${billing.to}T00:00:00Z`) - Date.parse(`${billing.from}T00:00:00Z`)) / DAY + 1;
    if (!Number.isFinite(days) || days < 1) issue(context, "PERIOD_ORDER", "BLOCCANTE", "periodo", `Periodo fatturato incoerente: inizio ${billing.from} dopo la fine ${billing.to}.`);
    else if (days > 400) issue(context, "PERIOD_LENGTH", "AVVISO", "periodo", `Periodo fatturato di ${Math.round(days)} giorni: verifica le date lette.`);
  }
  out.push(traced(context, { key: "periodo", label: "Periodo fatturato", names: ["periodoDal", "periodoAl", "periodoStampato"], indispensable: true, confirm: "billingPeriod", checked: true }, billing.raw));

  // Consumption: total of the period, bands, annual. An absent value is never zero.
  const unit = isGas ? "Smc" : "kWh";
  const billedField = isGas && bill?.smcConsumption?.status === "FOUND" ? bill.smcConsumption : bill?.billedConsumption;
  const billed = pick(billedField, "billedConsumption");
  const billedValue = billed.number ?? (billed.present ? italianNumber(billed.value) : null);
  const bands = isGas || legacy ? [] : [bill!.f1Consumption, bill!.f2Consumption, bill!.f3Consumption].map((field) => rawOf(field));
  const bandValues = bands.map((band) => band.present ? band.number : null);
  if (!billed.present) issue(context, "CONSUMPTION_MISSING", "BLOCCANTE", "consumoTotale", `Consumo del periodo (${unit}) non letto: un consumo assente non vale zero.`);
  else if (billedValue !== null && billedValue < 0) issue(context, "CONSUMPTION_NEGATIVE", "BLOCCANTE", "consumoTotale", `Consumo del periodo negativo (${billed.value} ${unit}).`);
  else if (billedValue === 0) {
    // A zero the three bands confirm is documented; a zero alone is confirmed by the operator against the bill.
    const backed = bands.length === 3 && bands.every((band) => band.present && band.number === 0);
    if (backed) issue(context, "CONSUMPTION_ZERO", "INFO", "consumoTotale", `Consumo del periodo stampato pari a zero ${unit}, confermato dai consumi per fascia: dato documentato, non un valore mancante.`);
    else issue(context, "CONSUMPTION_ZERO", "DA_CONFERMARE", "consumoTotale", `Consumo del periodo stampato pari a zero ${unit}: confrontalo con la bolletta (uno zero non è un valore mancante, ma va confermato).`, "billedConsumption");
  }
  if (bands.length) {
    bandValues.forEach((value, index) => { if (value !== null && value < 0) issue(context, "BAND_NEGATIVE", "BLOCCANTE", `consumoF${index + 1}`, `Consumo F${index + 1} negativo.`); });
    const read = bandValues.filter((value): value is number => value !== null);
    if (read.length === 3 && billedValue !== null) {
      const sum = read[0] + read[1] + read[2];
      if (Math.abs(sum - billedValue) > BANDS_SUM_TOLERANCE_KWH && !context.issues.some((item) => item.code === "BANDS_SUM")) {
        const message = `F1 + F2 + F3 = ${kwh(sum)} ma il consumo del periodo è ${kwh(billedValue)}: confronta i consumi per fascia e il totale con la bolletta.`;
        issue(context, "BANDS_SUM", "DA_CONFERMARE", "consumoTotale", message, "billedConsumption");
        for (const index of [1, 2, 3]) issue(context, "BANDS_SUM", "AVVISO", `consumoF${index}`, message);
      }
    } else if (read.length > 0 && read.length < 3) issue(context, "BANDS_PARTIAL", "AVVISO", "consumoTotale", `Letti ${read.length} consumi per fascia su 3: la ripartizione F1/F2/F3 non è completa.`);
  }
  if (!isGas && !legacy) bands.forEach((band, index) => out.push(traced(context, { key: `consumoF${index + 1}`, label: `Consumo F${index + 1}`, names: [`consumoF${index + 1}`], indispensable: false, checked: bandValues.every((value) => value !== null) && billedValue !== null }, band.present ? { ...band, value: `${band.value} kWh` } : band)));
  out.push(traced(context, { key: "consumoTotale", label: `Consumo del periodo (${unit})`, names: ["consumoFatturato", "consumoSmc"], indispensable: true, confirm: "billedConsumption", checked: bandValues.length === 3 && bandValues.every((value) => value !== null) }, billed.present ? { ...billed, number: billedValue, value: `${billed.value} ${unit}` } : billed));

  const declared = pick(bill?.annualConsumption, "annualConsumption");
  const declaredValue = declared.number ?? (declared.present ? italianNumber(declared.value) : null);
  if (declared.present && declaredValue !== null && declaredValue > 0) {
    out.push(traced(context, { key: "consumoAnnuo", label: `Consumo annuo (${unit})`, names: ["consumoAnnuo"], indispensable: false, confirm: "annualConsumption" }, { ...declared, value: `${declared.value} ${unit}` }));
  } else {
    const annual = resolveAnnualConsumption({ declared: null, billed: billedValue, periodStart: billing.from, periodEnd: billing.to, history: bill?.consumptionHistory ?? null });
    if (declared.present && declaredValue === 0) issue(context, "ANNUAL_ZERO", "AVVISO", "consumoAnnuo", "Consumo annuo stampato pari a zero: per le soglie delle offerte si usa la stima, dichiarata come tale.");
    if (annual.status === "ESTIMATED" && annual.value !== null) {
      issue(context, "ANNUAL_ESTIMATED", "INFO", "consumoAnnuo", `${ANNUAL_ESTIMATE_LABEL}.`);
      const origin = annual.source === "HISTORY" ? `media di ${annual.months.length} mesi dello storico consumi × 12` : annual.source === "BILLED_MONTHS" ? `media dei ${annual.months.length} mesi fatturati × 12` : `consumo del periodo ÷ ${annual.period?.months ?? "?"} mesi × 12`;
      out.push(traced(context, { key: "consumoAnnuo", label: `Consumo annuo (${unit})`, names: ["consumoAnnuo"], indispensable: false }, { present: true, value: `${Math.round(annual.value)} ${unit}`, number: annual.value, unreadable: false, corrected: false }, { provenance: "STIMATO", method: "STIMA", note: `${ANNUAL_ESTIMATE_LABEL}: ${origin}` }));
    } else {
      issue(context, "ANNUAL_NOT_DETERMINABLE", "AVVISO", "consumoAnnuo", "Consumo annuo non stampato e non stimabile dai dati letti.");
      out.push(traced(context, { key: "consumoAnnuo", label: `Consumo annuo (${unit})`, names: ["consumoAnnuo"], indispensable: false }, declared.present ? { ...declared, present: false } : declared));
    }
  }

  // Power and voltage (electricity only).
  if (!legacy && !isGas) {
    // Tony (26/11/2026): a committed power the bill prints in its supply data (fact POWER_COMMITTED, the source the calculation
    // reads in supplyProfile.powerCommitted) is as documentary as the reader's field: a bill is not blocked when only one of
    // the two carries it. The available power is never used in its place (the calculation does not do it either).
    const powerField = rawOf(bill!.powerKw);
    const profilePower = bill!.supplyProfile?.powerCommitted;
    const committedFact = factRaw(bill, "POWER_COMMITTED");
    const profileRaw: Raw = profilePower?.status === "FOUND" && profilePower.rawValue?.trim() ? { present: true, value: profilePower.rawValue.trim(), number: italianNumber(profilePower.rawValue), unreadable: false, corrected: false } : { present: false, value: "", number: null, unreadable: false, corrected: false };
    // A letter between digits ("3l5") is an ambiguous reading in the supply data too: never a number.
    const usable = (raw: Raw) => raw.present && raw.number !== null && !/\d[A-Za-z]\d/.test(raw.value);
    const committed: Raw = powerField.present ? powerField : usable(committedFact) ? committedFact : usable(profileRaw) ? profileRaw : powerField;
    const committedNote = !powerField.present && committed.present ? "dalla potenza impegnata stampata nei dati di fornitura" : null;
    const available = factRaw(bill, "POWER_AVAILABLE");
    const maximum = factRaw(bill, "POWER_MAXIMUM_DRAWN");
    if (!committed.present) issue(context, "POWER_COMMITTED_MISSING", "BLOCCANTE", "potenzaImpegnata", "Potenza impegnata non letta: serve per le quote potenza di rete calcolate dalle tariffe ARERA.");
    else if (committed.number !== null && committed.number <= 0) issue(context, "POWER_COMMITTED_INVALID", "BLOCCANTE", "potenzaImpegnata", `Potenza impegnata ${committed.value} kW non plausibile.`);
    if (committed.number !== null && available.number !== null && available.number + 0.001 < committed.number) issue(context, "POWER_AVAILABLE_BELOW_COMMITTED", "AVVISO", "potenzaDisponibile", `Potenza disponibile ${available.value} inferiore all'impegnata ${committed.value} kW: verifica la lettura.`);
    if (available.present && available.number === null) issue(context, "POWER_AVAILABLE_UNREADABLE", "AVVISO", "potenzaDisponibile", `Potenza disponibile «${available.value}» non interpretabile.`);
    if (maximum.present && maximum.number === null) issue(context, "POWER_MAXIMUM_UNREADABLE", "AVVISO", "potenzaMassima", `Potenza massima prelevata «${maximum.value}» non interpretabile.`);
    out.push(traced(context, { key: "potenzaImpegnata", label: "Potenza impegnata", names: ["potenzaImpegnataKw"], indispensable: true, checked: available.number !== null }, committed.present ? { ...committed, value: /kw/i.test(committed.value) ? committed.value : `${committed.value} kW` } : committed, { note: committedNote }));
    out.push(traced(context, { key: "potenzaDisponibile", label: "Potenza disponibile", names: ["potenzaDisponibileKw"], indispensable: false }, available));
    out.push(traced(context, { key: "potenzaMassima", label: "Potenza massima prelevata", names: ["potenzaMassimaPrelevataKw"], indispensable: false }, maximum));
    // Tony (26/11/2026, P12): the kW quantities of the charge lines billed per kW are read by the supply-profile completion
    // (ingestion/supply-profile-completion.ts) as the monthly maximum drawn power, the basis of the power quota. The same lines it
    // reads (unit kW, not kWh) are checked here: a quantity that is not a plain number ("1l,4", "3l5", "13,4 x 2") is not
    // interpretable, its text is kept and a definitive proposal is stopped. A plain number, zero included, is accepted.
    const kwLines = (bill!.economicChargeLines ?? []).filter((line) => /\bkw\b/i.test(line.unit ?? "") && !/kwh/i.test(line.unit ?? "") && (line.quantity ?? "").trim());
    const ambiguousKw = kwLines.filter((line) => !PLAIN_KW_QUANTITY.test(line.quantity.trim()));
    for (const line of ambiguousKw) issue(context, "POWER_QUANTITY_AMBIGUOUS", "BLOCCANTE", "potenzaFatturata", `Quantità in kW «${line.quantity.trim()}» della riga «${line.rawDescription ?? line.description}» non interpretabile: può alterare la potenza su cui si calcola la quota potenza. Rileggi la bolletta.`);
    if (kwLines.length) {
      const groups = ambiguousKw.length ? [] : kwGroups(kwLines);
      const numbers = new Set(groups.map((group) => group.number));
      const dated = new Set(groups.map((group) => group.period)).size > 1;
      if (numbers.size > 1) issue(context, "POWER_QUANTITIES_DIFFER", "AVVISO", "potenzaFatturata", `Le righe in kW riportano potenze diverse (${groups.map((group) => `${group.sources[0].text.replace(/\s*kW$/i, "")} kW${group.period ? ` per ${group.period}` : ""}`).join(", ")}): controlla sulla bolletta se si riferiscono a periodi o grandezze diverse.`);
      const billedRaw: Raw = ambiguousKw.length
        ? { present: false, value: "", number: null, unreadable: true, corrected: false }
        : { present: true, value: groups.map((group) => `${group.sources[0].text.replace(/\s*kW$/i, "")} kW${dated && group.period ? ` (${group.period})` : ""}`).join(", "), number: numbers.size === 1 ? groups[0].number : null, unreadable: false, corrected: false };
      const sources = kwLines.map(kwSource);
      const field = traced(context, { key: "potenzaFatturata", label: "Potenza fatturata nelle righe in kW", names: [], indispensable: false }, billedRaw, { note: ambiguousKw.length ? `stampato ma non interpretabile: ${ambiguousKw.map((line) => `«${line.quantity.trim()}»`).join(", ")}` : `righe: ${sources.map(sourceText).join("; ")}` });
      out.push({ ...field, page: field.page ?? sources.find((source) => source.page !== null)?.page ?? null, sources });
    }
    const voltage = rawOf(bill!.voltageLevel);
    if (!voltage.present) issue(context, "VOLTAGE_UNKNOWN", "AVVISO", "tensione", "Livello di tensione non letto.");
    out.push(traced(context, { key: "tensione", label: "Livello di tensione", names: ["tensioneStampata"], indispensable: false }, voltage.present ? { ...voltage, value: ({ LV: "BT", MV: "MT", HV: "AT", EHV: "AAT" } as Record<string, string>)[voltage.value] ?? voltage.value } : voltage));
  }

  // Offer, prices, PCV: optional; traced when printed, never an error when absent.
  if (!legacy) {
    out.push(traced(context, { key: "offerta", label: "Offerta attuale", names: ["offertaNome"], indispensable: false }, rawOf(bill!.offerName)));
    for (const [factCode, key, label, names] of [
      ["PCV", "pcv", "Quota fissa vendita (PCV)", ["pcvMensile"]], ["SPREAD", "spread", "Spread", ["spread"]],
      ["PRICE_F1", "prezzoF1", "Prezzo energia F1", ["prezzoEnergiaF1"]], ["PRICE_F2", "prezzoF2", "Prezzo energia F2", ["prezzoEnergiaF2"]],
      ["PRICE_F3", "prezzoF3", "Prezzo energia F3", ["prezzoEnergiaF3"]], ["MONORARIO_PRICE", "prezzoMonorario", "Prezzo energia monorario", ["prezzoEnergiaMonorario"]],
      ["ECONOMIC_EXPIRY", "scadenzaCondizioni", "Scadenza condizioni economiche", ["scadenzaCondizioni"]],
    ] as const) {
      const fact = factRaw(bill, factCode);
      if (!fact.present && !fact.unreadable && !uninterpretable(bill, names)) continue;
      if (fact.present && factCode !== "ECONOMIC_EXPIRY" && fact.number === null) issue(context, "PRICE_UNREADABLE", "AVVISO", key, `${label} «${fact.value}» non interpretabile come numero.`);
      out.push(traced(context, { key, label, names, indispensable: false }, fact));
    }
  }

  // Total of the bill and reconciliation.
  const total = pick(bill?.totalAmount, "totalAmount");
  const totalValue = total.number ?? (total.present ? italianNumber(total.value) : null);
  if (!total.present) issue(context, "TOTAL_MISSING", "BLOCCANTE", "totaleBolletta", "Totale bolletta non letto.");
  else if (totalValue !== null && totalValue < 0) issue(context, "TOTAL_NEGATIVE", "AVVISO", "totaleBolletta", "Totale bolletta negativo (nota di credito o conguaglio): verifica che sia la bolletta del periodo.");
  out.push(traced(context, { key: "totaleBolletta", label: "Totale bolletta", names: ["totaleBolletta"], indispensable: true, confirm: "totalAmount", checked: Boolean(bill?.economicChargeLines?.length) }, total.present ? { ...total, value: `${total.value} €` } : total));

  const issues = context.issues;
  const openIssues = issues.filter((item) => item.severity === "BLOCCANTE" || (item.severity === "DA_CONFERMARE" && !(item.confirmField && fields[item.confirmField]?.confirmed)));
  // Uncertain: estimated, calculated and not confirmed by the operator, or incoherent. A value read and not contradicted is not.
  const uncertainFields = out.filter((field) => field.indispensable && field.presence !== "NON_APPLICABILE" && (field.provenance === "STIMATO" || (field.provenance === "CALCOLATO" && field.reliability !== "VERIFICATO_OPERATORE") || field.reliability === "INCOERENTE")).map((field) => field.label);
  return { traceVersion: 1, vector, structuredReading: !legacy, reread: typeof bill?.readingReread === "boolean" ? bill.readingReread : null, fields: out, issues, openIssues, uncertainFields, definitiveAllowed: openIssues.length === 0 };
}

/** Throws when a definitive proposal cannot rest on this bill version: the codes of the open issues follow the error code. */
export function assertDefinitiveBillFields(trace: BillFieldTrace): void {
  if (!trace.definitiveAllowed) throw new Error("SOURCE_BILL_FIELDS_UNVERIFIED");
}
