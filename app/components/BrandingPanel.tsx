"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { EmptyState, ErrorState, FormField, LoadingState } from "./UiStates";
import { requestJson, toUiError } from "../lib/ui/client";
import type { TenantBrandingModel } from "../lib/ui/models";

type LogoDraft = TenantBrandingModel["logo"];
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const LOGO_MAX_BYTES = 262144;

export function brandingInitials(name: string | undefined): string {
  const words = (name ?? "").replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?)\b/gi, "").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "E";
}

export function BrandingMark({ branding, className }: { readonly branding: TenantBrandingModel | null; readonly className: string }) {
  return branding?.logo
    ? <div className={`${className} has-logo`}><img src={`data:${branding.logo.contentType};base64,${branding.logo.dataBase64}`} alt={`Logo ${branding.legalName}`} /></div>
    : <div className={className} aria-hidden="true">{brandingInitials(branding?.legalName)}</div>;
}

function uiError(error: unknown): string { const safe = toUiError(error); return `${safe.message}  codice ${safe.code}`; }

async function readLogo(file: File): Promise<LogoDraft> {
  const contentType = LOGO_TYPES.find((type) => type === file.type);
  if (!contentType) throw new Error("Il logo deve essere PNG, JPEG o WebP.");
  if (file.size > LOGO_MAX_BYTES) throw new Error("Il logo supera 256 KB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { contentType, dataBase64: btoa(binary), byteLength: bytes.length };
}

export default function BrandingPanel({ branding, state, canEdit, onSaved, onReload }: { readonly branding: TenantBrandingModel | null; readonly state: "loading" | "ready" | "error"; readonly canEdit: boolean; readonly onSaved: (branding: TenantBrandingModel) => void; readonly onReload: () => void }) {
  const [legalName, setLegalName] = useState(""); const [vatNumber, setVatNumber] = useState(""); const [address, setAddress] = useState(""); const [logo, setLogo] = useState<LogoDraft>(null);
  const [pending, setPending] = useState(false); const [error, setError] = useState<string>(); const [message, setMessage] = useState<string>(); const [nameError, setNameError] = useState<string>();
  useEffect(() => { if (!branding) return; setLegalName(branding.legalName); setVatNumber(branding.vatNumber ?? ""); setAddress(branding.address ?? ""); setLogo(branding.logo); }, [branding]);

  async function selectLogo(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setError(undefined); try { setLogo(await readLogo(file)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Logo non valido."); } }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!canEdit || pending) return;
    setError(undefined); setMessage(undefined); setNameError(undefined);
    if (legalName.trim().length < 2) { setNameError("Inserire la ragione sociale."); return; }
    setPending(true);
    try {
      const body = { legalName, vatNumber: vatNumber.trim() || null, address: address.trim() || null, logo: logo ? { contentType: logo.contentType, dataBase64: logo.dataBase64 } : null, expectedVersion: branding?.version ?? null };
      const response = await requestJson<{ readonly branding: TenantBrandingModel }>("/api/tenant/branding", { method: "PUT", body: JSON.stringify(body) });
      onSaved(response.branding); setMessage("Dati azienda salvati. Compaiono nell'intestazione e nelle proposte stampabili.");
    } catch (cause) { setError(uiError(cause)); } finally { setPending(false); }
  }

  const preview: TenantBrandingModel | null = branding ? { ...branding, legalName: legalName || branding.legalName, logo } : null;
  return <div className="content-stack"><div className="section-header"><div><p className="eyebrow">IDENTITÀ AZIENDALE</p><h2>Dati azienda</h2><p className="section-detail">Logo e ragione sociale della tua azienda compaiono nell&apos;intestazione dell&apos;app e su ogni proposta stampabile.</p></div></div>
    {state === "loading" ? <LoadingState label="Caricamento dati azienda" /> : state === "error" ? <ErrorState message="Dati azienda non disponibili" onRetry={onReload} /> : !branding ? <EmptyState title="Dati azienda non configurati" detail="L'archivio dei dati azienda non è disponibile in questo ambiente." /> : <div className="two-columns">
      <section className="ui-card"><h3>Anteprima intestazione</h3>{branding.synthetic ? <p className="muted">Dati di prova inventati: salva i dati reali della tua azienda per sostituirli.</p> : null}<div className="branding-preview"><BrandingMark branding={preview} className="branding-preview-logo" /><div><strong>{preview?.legalName}</strong>{vatNumber.trim() ? <span>P.IVA {vatNumber.trim()}</span> : null}{address.trim() ? <span>{address.trim()}</span> : null}</div></div></section>
      <section className="ui-card"><form onSubmit={(event) => void save(event)}><div className="card-heading"><h3>Modifica</h3><button className="button primary" type="submit" disabled={!canEdit || pending}>{pending ? "Salvataggio" : "Salva"}</button></div>{!canEdit ? <p className="muted">Solo l&apos;amministratore dell&apos;azienda può modificare questi dati.</p> : null}
        <FormField id="branding-legal-name" label="Ragione sociale" error={nameError}><input id="branding-legal-name" value={legalName} onChange={(event) => setLegalName(event.target.value)} disabled={!canEdit || pending} maxLength={160} /></FormField>
        <FormField id="branding-vat" label="Partita IVA" hint="11 cifre, con o senza prefisso IT."><input id="branding-vat" value={vatNumber} onChange={(event) => setVatNumber(event.target.value)} disabled={!canEdit || pending} maxLength={20} /></FormField>
        <FormField id="branding-address" label="Sede legale"><input id="branding-address" value={address} onChange={(event) => setAddress(event.target.value)} disabled={!canEdit || pending} maxLength={200} /></FormField>
        <div className="button-row"><label className="button secondary">{logo ? "Sostituisci logo" : "Carica logo"}<input className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void selectLogo(event)} disabled={!canEdit || pending} /></label><button className="button secondary" type="button" onClick={() => setLogo(null)} disabled={!canEdit || pending || !logo}>Rimuovi logo</button></div><p className="muted">PNG, JPEG o WebP, massimo 256 KB.</p>
        {error ? <ErrorState message={error} /> : null}{message ? <p className="inline-success" role="status">{message}</p> : null}
      </form></section>
    </div>}
  </div>;
}
