import type { ReactNode } from "react";
import type { BillReadRow, BillReadSection, BillReadSectionId } from "../lib/ui/bill-read-details";

// Tony (10/11/2026): "Dati letti" in four sections; each value says whether it was read, is not printed, must be checked or
// was calculated. Tony (10/11/2026, "ottimizzazione grafica"): compact grid, short labels, no "Letto" on every row: a value
// is the printed one unless it carries the asterisk of the legend (calculated by the simulator) or "da verificare"; the
// secondary values (not printed, zero, auxiliary such as the GME PUN) stay one click away under "Altri dettagli".
// Tony (11/11/2026, "pulizia finale"): the simulator's different classification is folded too, under its own heading.

export interface CalculatedFact { readonly label: string; readonly value: ReactNode; readonly note: string; readonly section: BillReadSectionId; readonly secondary?: boolean; readonly noteShown?: boolean }

type Entry = { readonly key: string; readonly label: string; readonly value: ReactNode; readonly state: BillReadRow["state"]; readonly note?: string; readonly noteShown?: boolean };

function Item({ entry, detailed }: { readonly entry: Entry; readonly detailed: boolean }): ReactNode {
  const calculated = entry.state === "CALCULATED";
  const review = entry.state === "REVIEW";
  const note = entry.note && (detailed || entry.noteShown || review) ? entry.note : null;
  return <div className={`bill-read-row bill-read-${entry.state.toLowerCase()}`}>
    <dt>{entry.label}{calculated ? <><span aria-hidden="true" className="bill-read-mark">*</span><span className="visually-hidden"> (calcolato dal simulatore)</span></> : null}</dt>
    <dd title={entry.note && !note ? entry.note : undefined}>{entry.value}{review && !note ? <small className="bill-read-note">da verificare</small> : null}{note ? <small className="bill-read-note">{note}</small> : null}</dd>
  </div>;
}

function entriesOf(section: BillReadSection, calculated: readonly CalculatedFact[]): { readonly main: readonly Entry[]; readonly simulator: readonly Entry[]; readonly more: readonly Entry[] } {
  const rows = section.rows.map((row, index): Entry & { readonly secondary?: boolean; readonly group?: string } => ({ key: `r${index}-${row.label}`, ...row }));
  const facts = calculated.filter((fact) => fact.section === section.id).map((fact, index): Entry & { readonly secondary?: boolean } => ({ key: `c${index}-${fact.label}`, label: fact.label, value: fact.value, state: "CALCULATED", note: fact.note, secondary: fact.secondary, ...(fact.noteShown ? { noteShown: true } : {}) }));
  return {
    main: [...rows.filter((row) => !row.secondary && row.group !== "SIMULATOR"), ...facts.filter((fact) => !fact.secondary)],
    simulator: rows.filter((row) => row.group === "SIMULATOR"),
    more: [...rows.filter((row) => row.secondary), ...facts.filter((fact) => fact.secondary)],
  };
}

export function BillReadDetails({ sections, calculated = [] }: { readonly sections: readonly BillReadSection[]; readonly calculated?: readonly CalculatedFact[] }): ReactNode {
  if (!sections.length && !calculated.length) return null;
  const known = new Set(sections.map((section) => section.id));
  const orphan = calculated.filter((fact) => !known.has(fact.section));
  return <div className="bill-read-details">
    <p className="bill-read-legend muted"><span aria-hidden="true" className="bill-read-mark">*</span> calcolato dal simulatore · gli altri valori sono quelli stampati in fattura</p>
    {sections.map((section) => {
      const { main, simulator, more } = entriesOf(section, calculated);
      return <section key={section.id} className="bill-read-section" aria-label={section.title}>
        <h4>{section.title}</h4>
        <dl className="bill-read-grid">{main.map((entry) => <Item key={entry.key} entry={entry} detailed={false} />)}</dl>
        {simulator.length ? <details className="bill-read-simulator">
          <summary>Classificazione del simulatore: differenze dalla fattura ({simulator.length})</summary>
          <dl className="bill-read-grid">{simulator.map((entry) => <Item key={entry.key} entry={{ ...entry, noteShown: true }} detailed={false} />)}</dl>
        </details> : null}
        {more.length ? <details className="bill-read-more">
          <summary>Altri dettagli ({more.length})</summary>
          <dl className="bill-read-grid">{more.map((entry) => <Item key={entry.key} entry={entry} detailed />)}</dl>
        </details> : null}
      </section>;
    })}
    {orphan.length ? <section className="bill-read-section" aria-label="Valori del simulatore">
      <h4>Valori del simulatore</h4>
      <dl className="bill-read-grid">{orphan.map((fact, index) => <Item key={`o${index}`} entry={{ key: `o${index}`, label: fact.label, value: fact.value, state: "CALCULATED", note: fact.note }} detailed />)}</dl>
    </section> : null}
  </div>;
}
