"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Bill, BillInput, BillCreateInput, Supply } from "../../modules/bills/types";
import type { CustomerView } from "../../modules/customers/types";
import { BillForm } from "./bill-form";
import { BillDetail } from "./detail";
import { money } from "./labels";
import styles from "./bills.module.css";

export function BillList({ bills, open, busy }: { bills: readonly Bill[]; open: (id: string) => void; busy: boolean }) {
  return bills.length ? <ul>{bills.map(bill => <li key={bill.id}><button disabled={busy} onClick={() => open(bill.id)}>
    {bill.documentNumber} · {bill.issueDate} · {money(bill.declaredDocumentTotal)}</button></li>)}</ul> : <p>Nessuna bolletta presente.</p>;
}
function SupplyForm({ customers, busy, save }: { customers: readonly CustomerView[]; busy: boolean;
  save: (input: { customerId: string; pod: string }) => Promise<void> }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void save({ customerId: String(data.get("customerId")), pod: String(data.get("pod")) });
  }
  return <details><summary>Nuova fornitura EE</summary><form method="post" onSubmit={submit}><fieldset disabled={busy}>
    <legend>Collega una fornitura a un cliente esistente</legend><label>Cliente<select required name="customerId" defaultValue="">
      <option value="">Seleziona cliente</option>{customers.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
    <label>POD<input name="pod" required maxLength={64} /></label><p>Il POD viene normalizzato e verificato solo sintatticamente.</p>
    <button>Crea fornitura</button></fieldset></form></details>;
}
export default function BillsWorkspace({ target }: { target?: string }) {
  const [bills, setBills] = useState<readonly Bill[] | null>(null);
  const [supplies, setSupplies] = useState<readonly Supply[]>([]);
  const [customers, setCustomers] = useState<readonly CustomerView[]>([]);
  const [selected, setSelected] = useState<Bill | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const query = target ? `?${new URLSearchParams({ targetTenantId: target })}` : "";
  const request = useCallback(async <T,>(path: string, method = "GET", input?: unknown): Promise<T> => {
    const response = await fetch(`/api/v2/${path}${query}`, { method, credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      throw new Error(body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "Servizio non disponibile.");
    }
    return response.json() as Promise<T>;
  }, [query]);
  const refresh = useCallback(async () => {
    const [nextBills, nextSupplies, nextCustomers] = await Promise.all([
      request<readonly Bill[]>("bills"), request<readonly Supply[]>("supplies"), request<readonly CustomerView[]>("customers"),
    ]);
    setBills(nextBills); setSupplies(nextSupplies); setCustomers(nextCustomers);
  }, [request]);
  useEffect(() => {
    let active = true;
    Promise.all([request<readonly Bill[]>("bills"), request<readonly Supply[]>("supplies"), request<readonly CustomerView[]>("customers")])
      .then(([b, s, c]) => { if (active) { setBills(b); setSupplies(s); setCustomers(c); } })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Servizio non disponibile."); });
    return () => { active = false; };
  }, [request]);
  async function action(operation: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : "Servizio non disponibile."); }
    finally { setBusy(false); }
  }
  async function save(input: BillInput | BillCreateInput) {
    await action(async () => {
      const bill = await request<Bill>(selected ? `bills/${selected.id}` : "bills", selected ? "PUT" : "POST", input);
      setSelected(bill); setEditing(false); setMessage("Bolletta salvata."); await refresh();
    });
  }
  return <div className={styles.workspace} aria-busy={busy}>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {bills === null ? <p>{error ? "Archivio non caricato." : "Caricamento archivio…"}</p> : <>
      <button disabled={busy || !supplies.length} onClick={() => { setSelected(null); setEditing(true); }}>Nuova bolletta</button>
      {!supplies.length && <p>Crea prima una fornitura per un cliente esistente.</p>}
      <SupplyForm customers={customers} busy={busy} save={input => action(async () => {
        await request<Supply>("supplies", "POST", input); await refresh(); setMessage("Fornitura creata.");
      })} />
      <BillList bills={bills} busy={busy} open={id => void action(async () => {
        setSelected(await request<Bill>(`bills/${id}`)); setEditing(false);
      })} />
      {editing ? <BillForm key={selected?.id ?? "new"} initial={selected} customers={customers} supplies={supplies} busy={busy} save={save} cancel={() => setEditing(false)} /> :
        selected && <BillDetail bill={selected} supply={supplies.find(s => s.id === selected.supplyId)} edit={() => setEditing(true)} />}
    </>}
    <button disabled={busy} onClick={() => void action(refresh)}>Aggiorna archivio</button>
  </div>;
}
