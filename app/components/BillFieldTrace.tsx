"use client";
import type { ReactNode } from "react";
import type { BillFieldTrace, TracedField, TraceIssue } from "../lib/reading/bill-field-trace";

// Tony (25/11/2026, attività 01): what the reading of the bill is worth, field by field, and what stops a definitive proposal.
// Only what the server traced is shown: nothing is recomputed or assumed here.

const PROVENANCE: Readonly<Record<TracedField["provenance"], string>> = { LETTO: "Letto", CALCOLATO: "Calcolato", STIMATO: "Stimato", ASSENTE: "Assente" };
const PRESENCE: Readonly<Record<TracedField["presence"], string>> = { DOCUMENTATO: "", ZERO_DOCUMENTATO: "zero documentato", ASSENTE: "non stampato", NON_APPLICABILE: "non applicabile", NON_INTERPRETABILE: "stampato ma non interpretabile" };
const RELIABILITY: Readonly<Record<TracedField["reliability"], string>> = { VERIFICATO_OPERATORE: "verificato dall'operatore", COERENTE: "coerente con gli altri dati", DA_VERIFICARE: "da verificare", INCOERENTE: "incoerente", NON_VALUTABILE: "" };

const confirmable = (issue: TraceIssue) => issue.severity === "DA_CONFERMARE" && issue.confirmField !== null;

/** The issues that stop a definitive proposal and the warnings, for the review of the bill. */
export function BillFieldIssues({ trace }: { readonly trace: BillFieldTrace }): ReactNode {
  const blocking = trace.openIssues.filter((issue) => !confirmable(issue));
  const toConfirm = trace.openIssues.filter(confirmable);
  const warnings = trace.issues.filter((issue) => issue.severity === "AVVISO");
  if (!blocking.length && !toConfirm.length && !warnings.length) return null;
  return <div className="field-trace-issues" role="status">
    {blocking.length ? <div className="warning-text"><strong>Dati indispensabili mancanti o non validi: la proposta definitiva non si può preparare</strong><ul>{blocking.map((issue) => <li key={`${issue.code}-${issue.field}`}>{issue.message}</li>)}</ul><p className="muted">Le simulazioni restano possibili e sono indicate come basate su dati incerti. Rileggi la bolletta o correggi i dati.</p></div> : null}
    {toConfirm.length ? <div className="warning-text"><strong>Da confrontare con la bolletta</strong><ul>{toConfirm.map((issue) => <li key={`${issue.code}-${issue.field}`}>{issue.message}</li>)}</ul><p className="muted">Con «Cerca le CTE utilizzabili» confermi di aver controllato questi dati sulla bolletta.</p></div> : null}
    {warnings.length ? <details className="field-trace-warnings"><summary>Altri avvisi della lettura ({warnings.length})</summary><ul>{warnings.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></details> : null}
  </div>;
}

/** Each traced field: value, where it comes from and how far it can be trusted. */
export function BillFieldTable({ trace }: { readonly trace: BillFieldTrace }): ReactNode {
  return <details className="field-trace">
    <summary>Provenienza e affidabilità dei dati letti</summary>
    {trace.structuredReading ? null : <p className="muted">Bolletta letta prima della lettura strutturata: sono tracciabili solo i campi confermati.</p>}
    {trace.reread ? <p className="muted">La bolletta è stata letta una seconda volta perché la prima lettura non quadrava.</p> : null}
    <table className="field-trace-table">
      <thead><tr><th scope="col">Dato</th><th scope="col">Valore</th><th scope="col">Provenienza</th><th scope="col">Affidabilità</th></tr></thead>
      <tbody>{trace.fields.map((field) => <tr key={field.key} className={`field-trace-row ${field.reliability.toLowerCase()}`}>
        <th scope="row">{field.label}{field.indispensable ? <span className="visually-hidden"> (indispensabile)</span> : null}{field.indispensable ? <span aria-hidden="true"> *</span> : null}</th>
        <td>{field.value || "—"}{PRESENCE[field.presence] ? <small> {PRESENCE[field.presence]}</small> : null}</td>
        <td>{PROVENANCE[field.provenance]}{field.page ? <small> · pag. {field.page}</small> : null}{field.note && field.provenance !== "LETTO" ? <small className="field-trace-note">{field.note}</small> : null}</td>
        <td>{RELIABILITY[field.reliability]}</td>
      </tr>)}</tbody>
    </table>
    <p className="muted">* dato indispensabile per la proposta.</p>
  </details>;
}

/** The labels of the fields the issues concern, once each ("POD, Potenza impegnata"). */
function fieldLabels(trace: BillFieldTrace, issues: readonly TraceIssue[]): string {
  const OTHER: Readonly<Record<string, string>> = { documento: "documento", componentiEconomiche: "componenti economiche", residenza: "residenza" };
  return [...new Set(issues.map((issue) => trace.fields.find((field) => field.key === issue.field)?.label ?? OTHER[issue.field] ?? issue.field))].join(", ");
}

/** The reason a definitive proposal is not available for this bill, or null when it is. */
export function definitiveProposalBlock(trace: BillFieldTrace | undefined): string | null {
  if (!trace || trace.definitiveAllowed) return null;
  return `Proposta definitiva non disponibile: dati della bolletta da completare o verificare (${fieldLabels(trace, trace.openIssues)}).`;
}

/** "Simulazione basata su dati incerti: …" when indispensable data are estimated, calculated or not verified. */
export function uncertainDataNote(trace: BillFieldTrace | undefined): string | null {
  if (!trace || (!trace.uncertainFields.length && trace.definitiveAllowed)) return null;
  const fields = trace.uncertainFields.length ? trace.uncertainFields.join(", ") : fieldLabels(trace, trace.openIssues);
  // Tony (26/11/2026, P12): when the bill cannot support a definitive proposal, the simulated amounts are said NOT VERIFIED.
  if (!trace.definitiveAllowed) return `Importi NON VERIFICATI: la simulazione usa dati della bolletta non verificati o non interpretabili (${fieldLabels(trace, trace.openIssues)}). Proposta definitiva non disponibile.`;
  return `Simulazione basata su dati incerti della bolletta: ${fields}.`;
}
