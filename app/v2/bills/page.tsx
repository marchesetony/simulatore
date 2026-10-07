import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authRuntime } from "@/v2/modules/auth/runtime";
import { SESSION_COOKIE } from "@/v2/modules/auth/http";
import { dashboardView } from "@/v2/app/dashboard/access";
import { loginFailure } from "@/v2/modules/auth/service";
import BillsWorkspace from "@/v2/app/bills/workspace";

export const dynamic = "force-dynamic";
export default async function BillsPage({ searchParams }: { searchParams: Promise<{ targetTenantId?: string | string[] }> }) {
  const tokens = (await cookies()).getAll(SESSION_COOKIE);
  if (tokens.length !== 1) redirect("/v2/login");
  let view;
  try { view = await dashboardView(tokens[0].value, authRuntime().dependencies); }
  catch (error) {
    if (loginFailure(error).kind === "AUTHENTICATION_UNAVAILABLE") return <main><h1>Bollette</h1><p role="alert">Accesso temporaneamente non disponibile.</p></main>;
  }
  if (!view) redirect("/v2/login");
  const { targetTenantId } = await searchParams;
  const target = typeof targetTenantId === "string" ? targetTenantId : undefined;
  return <main style={{ maxWidth: "70rem", margin: "auto", padding: "2rem" }}>
    <a href="/v2/dashboard">← Dashboard</a><h1>Bollette EE</h1><p>Forniture e fatture storiche inserite manualmente.</p>
    {view.scope === "PLATFORM" && <form method="get"><label>Azienda di destinazione (identificativo)
      <input name="targetTenantId" required maxLength={128} defaultValue={target} /></label><button>Seleziona azienda</button></form>}
    {view.scope === "PLATFORM" && !target ? <p>Seleziona un’azienda. Il server ne verifica esistenza e stato attivo.</p> :
      <BillsWorkspace key={target ?? "own"} target={target} />}
  </main>;
}
