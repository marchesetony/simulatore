import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authRuntime } from "@/v2/modules/auth/runtime";
import { SESSION_COOKIE } from "@/v2/modules/auth/http";
import { dashboardView } from "@/v2/app/dashboard/access";
import { loginFailure } from "@/v2/modules/auth/service";
import CteWorkspace from "@/v2/app/cte/workspace";
export const dynamic = "force-dynamic";
export default async function CtePage({ searchParams }: { readonly searchParams: Promise<{ readonly targetTenantId?: string | string[] }> }) {
  const tokens = (await cookies()).getAll(SESSION_COOKIE); if (tokens.length !== 1) redirect("/v2/login"); let view;
  try { view = await dashboardView(tokens[0].value, authRuntime().dependencies); } catch (error) { if (loginFailure(error).kind === "AUTHENTICATION_UNAVAILABLE") return <main><h1>Archivio CTE EE</h1><p role="alert">Accesso temporaneamente non disponibile.</p></main>; }
  if (!view) redirect("/v2/login"); const value = (await searchParams).targetTenantId; const target = typeof value === "string" ? value : undefined;
  return view.scope === "PLATFORM" && !target ? <main><h1>Archivio CTE EE</h1><form method="get"><label>Tenant <input name="targetTenantId" required /></label><button>Seleziona</button></form></main> : <CteWorkspace target={target} />;
}
