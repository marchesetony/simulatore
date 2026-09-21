"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState, LoadingState } from "./UiStates";
import { requestJson, toUiError } from "../lib/ui/client";
import { BILL_FEATURES, type BillFeature } from "../lib/foundation/bill-feature-permissions";

type TargetKind = "ADMIN" | "AGENT" | "GROUP";
type Target = { readonly targetType: "USER"; readonly targetId: string; readonly label: string; readonly role: "ADMIN" | "AGENT" };
type Group = { readonly targetType: "GROUP"; readonly targetId: string; readonly label: string };
type Governance = { readonly role: "SUPER_ADMIN" | "ADMIN" | "AGENT"; readonly effective: { readonly features: Readonly<Record<BillFeature, boolean>> }; readonly rules: readonly { readonly feature: BillFeature; readonly targetType: "USER" | "GROUP"; readonly targetId: string; readonly enabled: boolean }[]; readonly targets: readonly Target[]; readonly groups: readonly Group[] };

const labels: Readonly<Record<BillFeature, string>> = { BILL_TECHNICAL_DETAILS: "Dettaglio tecnico", REGULATORY_DETAILS: "Verifica regolatoria", EXPANDED_RECEIPT: "Scontrino ampliato", TECHNICAL_PROVENANCE: "Provenienza tecnica" };

function targetTypeFor(kind: TargetKind): "USER" | "GROUP" { return kind === "GROUP" ? "GROUP" : "USER"; }

export default function BillFeatureGovernancePanel() {
  const [data, setData] = useState<Governance | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [kind, setKind] = useState<TargetKind>("ADMIN");
  const [targetId, setTargetId] = useState("");
  const [pending, setPending] = useState<BillFeature | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setState("loading");
    try { setData(await requestJson<Governance>("/api/foundation/bill-feature-permissions")); setState("ready"); } catch (cause) { setError(toUiError(cause).message); setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const choices = useMemo(() => kind === "GROUP" ? data?.groups ?? [] : (data?.targets ?? []).filter((target) => target.role === kind), [data, kind]);
  useEffect(() => { if (!choices.some((choice) => choice.targetId === targetId)) setTargetId(choices[0]?.targetId ?? ""); }, [choices, targetId]);

  async function toggle(feature: BillFeature): Promise<void> {
    if (!targetId || !data || pending) return;
    const targetType = targetTypeFor(kind);
    const existing = data.rules.find((rule) => rule.feature === feature && rule.targetType === targetType && rule.targetId === targetId);
    setPending(feature); setError(undefined);
    try { await requestJson(`/api/foundation/bill-feature-permissions`, { method: "PUT", body: JSON.stringify({ feature, targetType, targetId, enabled: !(existing?.enabled ?? false) }) }); await load(); } catch (cause) { setError(toUiError(cause).message); } finally { setPending(null); }
  }

  if (state === "loading") return <section className="ui-card"><LoadingState label="Caricamento permessi funzionalità" /></section>;
  if (state === "error" || !data) return <section className="ui-card"><ErrorState message={error ?? "Permessi funzionalità non disponibili"} onRetry={() => void load()} /></section>;
  if (data.role !== "SUPER_ADMIN") return null;

  return <section className="ui-card"><div className="card-heading"><div><p className="eyebrow">GOVERNANCE SERVER-SIDE</p><h3>Permessi funzionalità bolletta</h3><p className="section-detail">Solo SUPER_ADMIN può concedere o revocare accessi tecnici. Default: negato.</p></div><button className="button secondary" type="button" onClick={() => void load()}>Aggiorna</button></div>{error ? <p className="inline-warning" role="status">{error}</p> : null}<div className="form-grid"><label className="form-field"><span className="form-label">Target</span><select value={kind} onChange={(event) => setKind(event.target.value as TargetKind)}><option value="ADMIN">ADMIN</option><option value="AGENT">AGENT</option><option value="GROUP">GRUPPO</option></select></label><label className="form-field"><span className="form-label">Destinatario</span><select value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={!choices.length}><option value="">{choices.length ? "Selezionare" : "Nessun target disponibile"}</option>{choices.map((choice) => <option key={choice.targetId} value={choice.targetId}>{choice.label}</option>)}</select></label></div><div className="data-list">{BILL_FEATURES.map((feature) => { const rule = data.rules.find((item) => item.feature === feature && item.targetType === targetTypeFor(kind) && item.targetId === targetId); const enabled = rule?.enabled ?? false; return <div className="data-line" key={feature}><span>{labels[feature]}</span><button className={enabled ? "button primary compact" : "button secondary compact"} type="button" onClick={() => void toggle(feature)} disabled={!targetId || pending !== null}>{pending === feature ? "Salvataggio…" : enabled ? "Abilitata" : "Negata"}</button></div>; })}</div></section>;
}
