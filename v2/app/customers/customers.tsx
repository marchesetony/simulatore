"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CustomerInput, CustomerView } from "../../modules/customers/types";
import styles from "./customers.module.css";

async function request<T>(url: string, method = "GET", data?: CustomerInput): Promise<T> {
  const response = await fetch(url, { method, credentials: "same-origin", cache: "no-store",
    headers: data ? { "Content-Type": "application/json" } : undefined, body: data ? JSON.stringify(data) : undefined });
  if (!response.ok) throw new Error(response.status === 400 ? "Controlla i dati inseriti." :
    response.status === 403 ? "Accesso non consentito." : response.status === 404 ? "Cliente non disponibile." : "Servizio temporaneamente non disponibile.");
  return response.json() as Promise<T>;
}

function useCustomers(target?: string) {
  const [rows, setRows] = useState<CustomerView[] | null>(null);
  const [selected, setSelected] = useState<CustomerView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = useCallback((id?: string) => `/api/v2/customers${id ? `/${encodeURIComponent(id)}` : ""}${
    target === undefined ? "" : `?${new URLSearchParams({ targetTenantId: target })}`}`, [target]);
  useEffect(() => {
    let active = true;
    request<CustomerView[]>(url()).then(value => { if (active) setRows(value); })
      .catch(() => { if (active) setError("Elenco non disponibile. Riprova ricaricando la pagina."); });
    return () => { active = false; };
  }, [url]);
  async function act(id?: string, data?: CustomerInput): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const result = await request<CustomerView>(url(id), data ? id ? "PUT" : "POST" : "GET", data);
      setSelected(result);
      if (data) setRows(await request<CustomerView[]>(url()));
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Operazione non disponibile."); return false; }
    finally { setBusy(false); }
  }
  return { rows, selected, busy, error, act, clear: () => setSelected(null) };
}

export function CustomerForm({ initial, busy, save, cancel }: { initial: CustomerView | null; busy: boolean;
  save: (data: CustomerInput) => Promise<void>; cancel: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    await save({ name: String(fields.get("name") ?? ""), taxCode: String(fields.get("taxCode") ?? "") || null,
      vatNumber: String(fields.get("vatNumber") ?? "") || null });
  }
  return <form method="post" action="/api/v2/customers" onSubmit={submit} className={styles.form}>
    <h2>{initial ? "Modifica anagrafica" : "Nuovo cliente"}</h2>
    <fieldset disabled={busy}><legend>Dati anagrafici</legend>
      <label>Nominativo / ragione sociale<input name="name" required maxLength={160} defaultValue={initial?.name} /></label>
      <label>Codice fiscale (facoltativo)<input name="taxCode" maxLength={32} defaultValue={initial?.taxCode ?? ""} /></label>
      <label>Partita IVA (facoltativa)<input name="vatNumber" maxLength={32} defaultValue={initial?.vatNumber ?? ""} /></label>
      <p>Gli identificativi fiscali sono controllati solo nel formato, non nella validità fiscale.</p>
      <button type="submit">{busy ? "Salvataggio…" : "Salva"}</button> <button type="button" onClick={cancel}>Annulla</button>
    </fieldset>
  </form>;
}

export function CustomerList({ rows, busy, open }: { rows: readonly CustomerView[]; busy: boolean; open: (id: string) => void }) {
  return rows.length === 0 ? <p>Nessun cliente presente.</p> : <ul className={styles.list}>
    {rows.map(row => <li key={row.id}><span>{row.name}</span><button disabled={busy} onClick={() => open(row.id)}>Apri dettaglio</button></li>)}
  </ul>;
}

export default function Customers({ target }: { target?: string }) {
  const state = useCustomers(target);
  const [editing, setEditing] = useState(false);
  async function save(data: CustomerInput) { if (await state.act(state.selected?.id, data)) setEditing(false); }
  return <section className={styles.panel} aria-label="Gestione clienti" aria-busy={state.busy}>
    {state.error && <p role="alert">{state.error}</p>}
    {!state.error && state.rows === null && <p role="status">Caricamento clienti…</p>}
    {state.rows !== null && <>
      <button disabled={state.busy} onClick={() => { state.clear(); setEditing(true); }}>Nuovo cliente</button>
      <CustomerList rows={state.rows} busy={state.busy} open={id => { setEditing(false); state.clear(); void state.act(id); }} />
    </>}
    {editing ? <CustomerForm key={state.selected?.id ?? "new"} initial={state.selected} busy={state.busy} save={save} cancel={() => setEditing(false)} /> :
      state.selected && <section className={styles.detail}><h2>{state.selected.name}</h2><dl>
        <dt>Codice fiscale</dt><dd>{state.selected.taxCode ?? "Non indicato"}</dd>
        <dt>Partita IVA</dt><dd>{state.selected.vatNumber ?? "Non indicata"}</dd></dl>
        <button disabled={state.busy} onClick={() => setEditing(true)}>Modifica anagrafica</button>
      </section>}
  </section>;
}
