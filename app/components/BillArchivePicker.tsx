import type { ReactNode } from "react";
import { searchArchive, type ArchiveList, type BillArchiveEntry } from "../lib/ui/bill-archive";

// Tony (10/11/2026): two distinct groups of bills already uploaded, each with holder, POD, billed period and state, with
// explicit messages for an empty list, a search without results and a list that could not be loaded (never a partial list).

function Group({ title, note, list, query, empty, disabled, onOpen, onRetry }: { readonly title: string; readonly note: string; readonly list: ArchiveList; readonly query: string; readonly empty: string; readonly disabled: boolean; readonly onOpen: (id: string) => void; readonly onRetry: () => void }): ReactNode {
  const shown: readonly BillArchiveEntry[] = list.status === "ready" ? searchArchive(list.entries, query) : [];
  return <section className="bill-archive-group" aria-label={title}>
    <h4>{title}{list.status === "ready" && list.entries.length ? <small className="muted"> {list.entries.length === 1 ? "1 bolletta" : `${list.entries.length} bollette`}</small> : null}</h4>
    <p className="muted">{note}</p>
    {list.status === "loading" ? <p className="muted" role="status">Caricamento dell&apos;elenco…</p>
      : list.status === "error" ? <div className="warning-text" role="alert"><p>{list.message}</p><button className="button compact secondary" type="button" onClick={onRetry} disabled={disabled}>Riprova</button></div>
      : !list.entries.length ? <p className="muted">{empty}</p>
      : !shown.length ? <p className="muted">Nessuna bolletta di questo gruppo corrisponde alla ricerca.</p>
      : <ul className="bill-archive-list">{shown.map((entry) => <li key={entry.id}>
        <button type="button" className="bill-archive-row" onClick={() => onOpen(entry.id)} disabled={disabled || !entry.openable} aria-label={`Apri la bolletta di ${entry.holder}, POD ${entry.pod}, ${entry.period}, ${entry.stateLabel}`}>
          <strong>{entry.holder}</strong>
          <span>POD {entry.pod}</span>
          <span>{entry.period}</span>
          <span className={`bill-archive-state bill-archive-${entry.state.toLowerCase()}`}>{entry.stateLabel}</span>
        </button>
        {entry.openable ? null : <small className="muted">La lettura non è riuscita: carica di nuovo il PDF.</small>}
      </li>)}</ul>}
  </section>;
}

export function BillArchivePicker({ pendingBills, approvedBills, query, disabled, onOpen, onRetry }: { readonly pendingBills: ArchiveList; readonly approvedBills: ArchiveList; readonly query: string; readonly disabled: boolean; readonly onOpen: (id: string) => void; readonly onRetry: () => void }): ReactNode {
  return <div className="bill-archive">
    <Group title="Bollette da completare" note="Non ancora approvate: si aprono su «Dati letti» per completare la revisione. Le offerte si calcolano solo dopo la conferma dei dati." list={pendingBills} query={query} empty="Nessuna bolletta da completare." disabled={disabled} onOpen={onOpen} onRetry={onRetry} />
    <Group title="Bollette già disponibili" note="Approvate: si riaprono senza caricare di nuovo il PDF." list={approvedBills} query={query} empty="Nessuna bolletta approvata disponibile." disabled={disabled} onOpen={onOpen} onRetry={onRetry} />
  </div>;
}
