"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState, LoadingState } from "./UiStates";
import { requestJson, toUiError } from "../lib/ui/client";

type Level = "AZIENDA" | "DIRETTORE" | "AREA_MANAGER" | "AGENTE" | "SUB_AGENTE";
type Vector = "EE" | "GAS";
type Category = "RESIDENTIAL" | "NON_RESIDENTIAL";
type Limits = { readonly vectors: readonly Vector[] | null; readonly customerCategories: readonly Category[] | null; readonly excludedCteArchiveIds: readonly string[] };
type Node = { readonly userId: string; readonly level: Level; readonly parentUserId: string | null; readonly displayName: string | null; readonly limits: Limits; readonly effectiveLimits: Limits; readonly ancestorUserIds: readonly string[]; readonly version: number };
type Member = { readonly userId: string; readonly displayName: string | null; readonly role: string; readonly allowedLevels: readonly Level[]; readonly placed: boolean };
type Chain = { readonly actor: { readonly userId: string; readonly role: string; readonly level: Level | null; readonly effectiveLimits: Limits; readonly canManageCompany: boolean }; readonly nodes: readonly Node[]; readonly members: readonly Member[] };
type Assignment = { readonly validFrom: string; readonly validTo: string | null; readonly scope: "ALL" | "BRANCHES"; readonly assigneeUserIds: readonly string[]; readonly version: number };
type Cte = { readonly archiveId: string; readonly cteId: string; readonly vector: Vector; readonly supplier: string | null; readonly offerName: string | null; readonly offerCode: string | null; readonly approved: boolean; readonly assignment: Assignment | null; readonly usability: string };
type CteList = { readonly asOf: string; readonly canAssign: boolean; readonly ctes: readonly Cte[] };

const LEVELS: readonly Level[] = ["AZIENDA", "DIRETTORE", "AREA_MANAGER", "AGENTE", "SUB_AGENTE"];
const LEVEL_LABEL: Readonly<Record<Level, string>> = { AZIENDA: "Azienda", DIRETTORE: "Direttore", AREA_MANAGER: "Area Manager", AGENTE: "Agente", SUB_AGENTE: "Sub-agente" };
const VECTOR_LABEL: Readonly<Record<Vector, string>> = { EE: "Luce", GAS: "Gas" };
const CATEGORY_LABEL: Readonly<Record<Category, string>> = { RESIDENTIAL: "Domestici", NON_RESIDENTIAL: "Non domestici" };
const USABILITY_LABEL: Readonly<Record<string, string>> = { USABLE: "Utilizzabile", NOT_YET_VALID: "Non ancora valida", EXPIRED: "Scaduta", EXCLUDED_BY_LIMITS: "Esclusa dai limiti", NOT_ASSIGNED: "Non assegnata" };

function errorText(cause: unknown): string { const safe = toUiError(cause); return `${safe.message}  codice ${safe.code}`; }
function nodeName(node: Pick<Node, "displayName" | "userId"> | undefined, fallback: string): string { return node?.displayName ?? node?.userId ?? fallback; }
function limitsSummary(limits: Limits): string {
  const vectors = limits.vectors ? limits.vectors.map((item) => VECTOR_LABEL[item]).join(" e ") : "Luce e gas";
  const categories = limits.customerCategories ? limits.customerCategories.map((item) => CATEGORY_LABEL[item]).join(" e ") : "tutti i clienti";
  const excluded = limits.excludedCteArchiveIds.length ? `, ${limits.excludedCteArchiveIds.length} CTE escluse` : "";
  return `${vectors}, ${categories}${excluded}`;
}
function toggle<T>(list: readonly T[], item: T): readonly T[] { return list.includes(item) ? list.filter((value) => value !== item) : [...list, item]; }

function ChainTree({ nodes, canEdit, onEdit }: { readonly nodes: readonly Node[]; readonly canEdit: (node: Node) => boolean; readonly onEdit: (node: Node) => void }) {
  const byParent = useMemo(() => { const map = new Map<string | null, Node[]>(); for (const node of nodes) { const parent = nodes.some((item) => item.userId === node.parentUserId) ? node.parentUserId : null; map.set(parent, [...(map.get(parent) ?? []), node]); } return map; }, [nodes]);
  const render = (parent: string | null, depth: number): React.ReactNode => (byParent.get(parent) ?? []).map((node) => <li key={node.userId} style={{ paddingLeft: depth * 20 }}>
    <div className="chain-row"><span className="status-badge">{LEVEL_LABEL[node.level]}</span><strong>{nodeName(node, node.userId)}</strong><span className="muted">{limitsSummary(node.effectiveLimits)}</span>{canEdit(node) ? <button className="button secondary compact" type="button" onClick={() => onEdit(node)}>Modifica</button> : null}</div>
    <ul className="chain-list">{render(node.userId, depth + 1)}</ul>
  </li>);
  return nodes.length ? <ul className="chain-list">{render(null, 0)}</ul> : <p className="muted">La catena è vuota: inizia inserendo l&apos;azienda.</p>;
}

export default function HierarchyPanel() {
  const [chain, setChain] = useState<Chain | null>(null);
  const [ctes, setCtes] = useState<CteList | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const [userId, setUserId] = useState(""); const [level, setLevel] = useState<Level>("AGENTE"); const [parentUserId, setParentUserId] = useState(""); const [displayName, setDisplayName] = useState("");
  const [vectors, setVectors] = useState<readonly Vector[] | null>(null); const [categories, setCategories] = useState<readonly Category[] | null>(null); const [excluded, setExcluded] = useState<readonly string[]>([]);

  const load = useCallback(async () => {
    setState("loading");
    try { const [nextChain, nextCtes] = await Promise.all([requestJson<Chain>("/api/hierarchy"), requestJson<CteList>("/api/cte/assignments")]); setChain(nextChain); setCtes(nextCtes); setState("ready"); }
    catch (cause) { setError(errorText(cause)); setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const existing = chain?.nodes.find((node) => node.userId === userId) ?? null;
  const member = chain?.members.find((item) => item.userId === userId) ?? null;
  const parents = (chain?.nodes ?? []).filter((node) => LEVELS.indexOf(node.level) < LEVELS.indexOf(level) && node.userId !== userId);
  const parentLimits = chain?.nodes.find((node) => node.userId === parentUserId)?.effectiveLimits ?? null;

  function edit(node: Node | null, nextUserId = "") {
    setMessage(undefined); setError(undefined);
    setUserId(node?.userId ?? nextUserId); setLevel(node?.level ?? (chain?.members.find((item) => item.userId === nextUserId)?.allowedLevels[0] ?? "AGENTE")); setParentUserId(node?.parentUserId ?? ""); setDisplayName(node?.displayName ?? chain?.members.find((item) => item.userId === nextUserId)?.displayName ?? "");
    setVectors(node?.limits.vectors ?? null); setCategories(node?.limits.customerCategories ?? null); setExcluded(node?.limits.excludedCteArchiveIds ?? []);
  }

  async function save(event: FormEvent) {
    event.preventDefault(); if (!userId || pending) return;
    setPending(true); setError(undefined); setMessage(undefined);
    try {
      await requestJson("/api/hierarchy", { method: "PUT", body: JSON.stringify({ userId, level, parentUserId: level === "AZIENDA" ? null : parentUserId || null, displayName: displayName.trim() || null, limits: { vectors, customerCategories: categories, excludedCteArchiveIds: excluded }, expectedVersion: existing?.version ?? null }) });
      setMessage("Catena aggiornata."); await load();
    } catch (cause) { setError(errorText(cause)); } finally { setPending(false); }
  }

  async function remove() {
    if (!existing || pending) return;
    setPending(true); setError(undefined);
    try { await requestJson("/api/hierarchy", { method: "DELETE", body: JSON.stringify({ userId: existing.userId, expectedVersion: existing.version }) }); edit(null); setMessage("Rimosso dalla catena."); await load(); }
    catch (cause) { setError(errorText(cause)); } finally { setPending(false); }
  }

  if (state === "loading") return <LoadingState label="Caricamento catena commerciale" />;
  if (state === "error" || !chain || !ctes) return <ErrorState message={error ?? "Catena non disponibile"} onRetry={() => void load()} />;
  const placeable = chain.members.filter((item) => !item.placed);

  return <div className="content-stack">
    <div className="section-header"><div><p className="eyebrow">STRUTTURA COMMERCIALE</p><h2>Catena e CTE</h2><p className="section-detail">Azienda, Direttore, Area Manager, Agente e Sub-agente: ogni livello può solo restringere quello che il livello sopra consente.</p></div></div>
    <div className="two-columns">
      <section className="ui-card"><div className="card-heading"><h3>Catena commerciale</h3></div>
        {chain.actor.level ? <p className="muted">Il tuo livello: {LEVEL_LABEL[chain.actor.level]}. Puoi vendere: {limitsSummary(chain.actor.effectiveLimits)}.</p> : null}
        <ChainTree nodes={chain.nodes} canEdit={(node) => chain.actor.canManageCompany || node.ancestorUserIds.includes(chain.actor.userId)} onEdit={(node) => edit(node)} />
        {placeable.length ? <div className="form-field"><label className="form-label" htmlFor="chain-add">Inserisci nella catena</label><select id="chain-add" value="" onChange={(event) => edit(null, event.target.value)}><option value="">Selezionare un utente</option>{placeable.map((item) => <option key={item.userId} value={item.userId}>{item.displayName ?? item.userId} ({item.allowedLevels.map((value) => LEVEL_LABEL[value]).join(" / ")})</option>)}</select></div> : null}
      </section>
      <section className="ui-card"><form onSubmit={(event) => void save(event)}>
        <div className="card-heading"><h3>{existing ? `Modifica ${nodeName(existing, userId)}` : userId ? `Nuovo: ${displayName || userId}` : "Seleziona una persona"}</h3><button className="button primary" type="submit" disabled={!userId || pending}>{pending ? "Salvataggio" : "Salva"}</button></div>
        {userId ? <>
          <div className="form-grid">
            <div className="form-field"><label className="form-label" htmlFor="chain-level">Livello</label><select id="chain-level" value={level} onChange={(event) => setLevel(event.target.value as Level)}>{(member?.allowedLevels ?? [level]).map((value) => <option key={value} value={value}>{LEVEL_LABEL[value]}</option>)}</select></div>
            {level !== "AZIENDA" ? <div className="form-field"><label className="form-label" htmlFor="chain-parent">Responsabile</label><select id="chain-parent" value={parentUserId} onChange={(event) => setParentUserId(event.target.value)}><option value="">Selezionare</option>{parents.map((node) => <option key={node.userId} value={node.userId}>{LEVEL_LABEL[node.level]}: {nodeName(node, node.userId)}</option>)}</select></div> : null}
            <div className="form-field"><label className="form-label" htmlFor="chain-name">Nome visualizzato</label><input id="chain-name" value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} /></div>
          </div>
          {parentLimits ? <p className="muted">Il responsabile consente: {limitsSummary(parentLimits)}.</p> : null}
          <fieldset className="fieldset"><legend className="form-label">Forniture</legend><label><input type="checkbox" checked={vectors === null} onChange={() => setVectors(vectors === null ? ["EE"] : null)} /> Come il responsabile</label>{vectors !== null ? (["EE", "GAS"] as const).map((item) => <label key={item}><input type="checkbox" checked={vectors.includes(item)} onChange={() => setVectors(toggle(vectors, item))} /> {VECTOR_LABEL[item]}</label>) : null}</fieldset>
          <fieldset className="fieldset"><legend className="form-label">Clienti</legend><label><input type="checkbox" checked={categories === null} onChange={() => setCategories(categories === null ? ["RESIDENTIAL"] : null)} /> Come il responsabile</label>{categories !== null ? (["RESIDENTIAL", "NON_RESIDENTIAL"] as const).map((item) => <label key={item}><input type="checkbox" checked={categories.includes(item)} onChange={() => setCategories(toggle(categories, item))} /> {CATEGORY_LABEL[item]}</label>) : null}</fieldset>
          <fieldset className="fieldset"><legend className="form-label">CTE escluse per questo ramo</legend>{ctes.ctes.length ? ctes.ctes.map((cte) => <label key={cte.archiveId}><input type="checkbox" checked={excluded.includes(cte.archiveId)} onChange={() => setExcluded(toggle(excluded, cte.archiveId))} /> {cte.supplier ?? cte.cteId} {cte.offerCode ?? ""}</label>) : <p className="muted">Nessuna CTE disponibile.</p>}</fieldset>
          {existing ? <div className="button-row"><button className="button secondary" type="button" disabled={pending} onClick={() => void remove()}>Rimuovi dalla catena</button></div> : null}
        </> : <p className="muted">Scegli una persona dalla catena o aggiungine una nuova.</p>}
        {error ? <ErrorState message={error} /> : null}{message ? <p className="inline-success" role="status">{message}</p> : null}
      </form></section>
    </div>
    <CteAssignments data={ctes} nodes={chain.nodes} onSaved={() => void load()} />
  </div>;
}

function CteAssignmentRow({ cte, nodes, onSaved }: { readonly cte: Cte; readonly nodes: readonly Node[]; readonly onSaved: () => void }) {
  const [validFrom, setValidFrom] = useState(cte.assignment?.validFrom ?? new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = useState(cte.assignment?.validTo ?? "");
  const [assignees, setAssignees] = useState<readonly string[]>(cte.assignment?.assigneeUserIds ?? []);
  const [scope, setScope] = useState<"ALL" | "BRANCHES">(cte.assignment?.scope ?? "ALL");
  const [pending, setPending] = useState(false); const [error, setError] = useState<string>();
  async function save() {
    setPending(true); setError(undefined);
    try { await requestJson("/api/cte/assignments", { method: "PUT", body: JSON.stringify({ archiveId: cte.archiveId, validFrom, validTo: validTo || null, scope, assigneeUserIds: scope === "BRANCHES" ? assignees : [], expectedVersion: cte.assignment?.version ?? null }) }); onSaved(); }
    catch (cause) { setError(errorText(cause)); } finally { setPending(false); }
  }
  return <tr>
    <td><strong>{cte.supplier ?? cte.cteId}</strong><br /><span className="muted">{cte.offerCode ?? cte.offerName ?? cte.archiveId} · {VECTOR_LABEL[cte.vector]}</span></td>
    <td><input type="date" aria-label="Valida dal" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></td>
    <td><input type="date" aria-label="Valida fino al" value={validTo} onChange={(event) => setValidTo(event.target.value)} /></td>
    <td><select aria-label="Chi può usarla" value={scope} onChange={(event) => setScope(event.target.value as "ALL" | "BRANCHES")}><option value="ALL">Tutta l&apos;azienda</option><option value="BRANCHES">Solo i rami scelti</option></select>
      {scope === "BRANCHES" ? <div className="assignee-list">{nodes.filter((node) => node.level !== "AZIENDA").map((node) => <label key={node.userId}><input type="checkbox" checked={assignees.includes(node.userId)} onChange={() => setAssignees(toggle(assignees, node.userId))} /> {LEVEL_LABEL[node.level]}: {nodeName(node, node.userId)}</label>)}</div> : null}
      {error ? <p className="field-error">{error}</p> : null}</td>
    <td>{USABILITY_LABEL[cte.usability] ?? cte.usability}</td>
    <td><button className="button secondary compact" type="button" disabled={pending} onClick={() => void save()}>{pending ? "Salvataggio" : "Salva"}</button></td>
  </tr>;
}

function CteAssignments({ data, nodes, onSaved }: { readonly data: CteList; readonly nodes: readonly Node[]; readonly onSaved: () => void }) {
  if (!data.canAssign) return <section className="ui-card"><div className="card-heading"><h3>CTE che puoi proporre oggi</h3></div>{data.ctes.length ? <ul className="plain-list">{data.ctes.map((cte) => <li key={cte.archiveId}>{cte.supplier ?? cte.cteId} {cte.offerCode ?? ""} · {VECTOR_LABEL[cte.vector]}</li>)}</ul> : <p className="muted">Nessuna CTE assegnata al tuo ramo.</p>}</section>;
  return <section className="ui-card"><div className="card-heading"><h3>Assegnazione CTE</h3></div>
    <p className="muted">Per ogni CTE scegli il periodo di validità e chi può usarla. Un ramo assegnato vale per tutte le persone sotto quel responsabile.</p>
    <div className="responsive-table"><table><thead><tr><th>CTE</th><th>Valida dal</th><th>Fino al</th><th>Chi può usarla</th><th>Stato oggi</th><th></th></tr></thead>
      <tbody>{data.ctes.map((cte) => <CteAssignmentRow key={`${cte.archiveId}-${cte.assignment?.version ?? 0}`} cte={cte} nodes={nodes} onSaved={onSaved} />)}</tbody></table></div>
  </section>;
}
