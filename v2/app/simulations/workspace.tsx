"use client";
import { useCallback, useEffect, useState } from "react";
import type { Bill } from "../../modules/bills/types";
import type { Simulation, SimulationCreateInput } from "../../modules/simulations/types";
import SimulationForm from "./form";
import SimulationDetail, { ScopeNotice } from "./detail";
import styles from "./simulations.module.css";

export function SimulationList({ rows, open }: { rows: readonly Simulation[]; open: (id: string) => void }) {
  return rows.length ? <ul>{rows.map(row => <li key={row.id}><button onClick={() => open(row.id)}>
    {row.inputSnapshot.billReference.documentNumber} · {row.status === "CALCULATED" ? "Calcolata" : "Bloccata"}
  </button></li>)}</ul> : <p>Nessuna simulazione presente.</p>;
}
export default function SimulationsWorkspace({ target }: { target?: string }) {
  const [rows, setRows] = useState<readonly Simulation[] | null>(null);
  const [bills, setBills] = useState<readonly Bill[]>([]);
  const [selected, setSelected] = useState<Simulation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = target ? `?${new URLSearchParams({ targetTenantId: target })}` : "";
  const request = useCallback(async <T,>(path: string, input?: SimulationCreateInput): Promise<T> => {
    const response = await fetch(`/api/v2/${path}${query}`, { method: input ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, ...(input ? { body: JSON.stringify(input) } : {}) });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      throw new Error(body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "Servizio non disponibile.");
    }
    return response.json() as Promise<T>;
  }, [query]);
  useEffect(() => {
    let active = true;
    Promise.all([request<readonly Simulation[]>("simulations"), request<readonly Bill[]>("bills")])
      .then(([nextRows, nextBills]) => { if (active) { setRows(nextRows); setBills(nextBills); } })
      .catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "Servizio non disponibile."); });
    return () => { active = false; };
  }, [request]);
  async function action(operation: () => Promise<void>) {
    setBusy(true); setError("");
    try { await operation(); } catch (error) { setError(error instanceof Error ? error.message : "Servizio non disponibile."); }
    finally { setBusy(false); }
  }
  return <div className={styles.workspace} aria-busy={busy}><ScopeNotice />
    {error && <p role="alert">{error}</p>}
    {rows === null ? <p>{error ? "Archivio non caricato." : "Caricamento…"}</p> : <fieldset disabled={busy}>
      <legend>Archivio simulazioni</legend><SimulationList rows={rows} open={id => void action(async () => setSelected(await request<Simulation>(`simulations/${id}`)))} />
      {bills.length ? <SimulationForm bills={bills} busy={busy} create={input => action(async () => {
        const created = await request<Simulation>("simulations", input); setSelected(created); setRows(await request<readonly Simulation[]>("simulations"));
      })} /> : <p>Serve una bolletta di riferimento disponibile.</p>}
      {selected && <SimulationDetail simulation={selected} />}
    </fieldset>}
  </div>;
}
