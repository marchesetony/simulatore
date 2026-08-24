"use client";

import { useEffect, useState, type ReactNode } from "react";

type GateState = "checking" | "ready" | "redirecting";

export default function ProductionAuthGate({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json();
        return response.ok && typeof body === "object" && body !== null && "authenticated" in body && body.authenticated === true;
      })
      .then((authenticated) => {
        if (!authenticated) {
          setState("redirecting");
          window.location.replace("/login");
        } else setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState("redirecting");
          window.location.replace("/login");
        }
      });
    return () => controller.abort();
  }, []);

  if (state !== "ready") return <main className="auth-gate"><div className="auth-gate-card"><span className="eyebrow">CONTESTO AUTENTICATO</span><h1>{state === "checking" ? "Verifica accesso" : "Reindirizzamento"}</h1><p>Verifica server-side in corso.</p></div></main>;
  return <>{children}</>;
}
