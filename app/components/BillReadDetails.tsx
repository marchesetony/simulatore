import type { ReactNode } from "react";
import type { BillReadSection, BillReadState } from "../lib/ui/bill-read-details";

// Tony (10/11/2026): "Dati letti" in four sections; each value says whether it was read, is not printed, must be checked or
// was calculated. What the simulator derives (segment, PUN, spread from the PUN) is listed apart under its own heading.

export interface CalculatedFact { readonly label: string; readonly value: ReactNode; readonly note: string }

const STATE_LABEL: Readonly<Record<BillReadState, string>> = { READ: "Letto", ABSENT: "Non presente", REVIEW: "Da verificare", CALCULATED: "Calcolato", NOT_READ: "Non letto" };

export function BillReadDetails({ sections, calculated = [] }: { readonly sections: readonly BillReadSection[]; readonly calculated?: readonly CalculatedFact[] }): ReactNode {
  if (!sections.length && !calculated.length) return null;
  return <div className="bill-read-details">
    {sections.map((section) => <section key={section.id} className="bill-read-section" aria-label={section.title}>
      <h4>{section.title}</h4>
      {section.note ? <p className="muted">{section.note}</p> : null}
      <dl className="quote-bill-grid">{section.rows.map((row, index) => <div key={`${row.label}-${index}`} className={`bill-read-row bill-read-${row.state.toLowerCase()}`}>
        <dt>{row.label} <small className="bill-read-state">{STATE_LABEL[row.state]}</small></dt>
        <dd>{row.value}{row.note ? <small className="bill-read-note">{row.note}</small> : null}</dd>
      </div>)}</dl>
    </section>)}
    {calculated.length ? <section className="bill-read-section" aria-label="Valori calcolati o classificati dal simulatore">
      <h4>Valori calcolati o classificati dal simulatore</h4>
      <p className="muted">Non sono stampati in fattura: il simulatore li ricava dai dati letti o dagli archivi ufficiali.</p>
      <dl className="quote-bill-grid">{calculated.map((fact) => <div key={fact.label} className="bill-read-row bill-read-calculated">
        <dt>{fact.label} <small className="bill-read-state">{STATE_LABEL.CALCULATED}</small></dt>
        <dd>{fact.value}<small className="bill-read-note">{fact.note}</small></dd>
      </div>)}</dl>
    </section> : null}
  </div>;
}
