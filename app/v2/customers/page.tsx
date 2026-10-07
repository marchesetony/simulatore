import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authRuntime } from "@/v2/modules/auth/runtime";
import { SESSION_COOKIE } from "@/v2/modules/auth/http";
import { loginFailure } from "@/v2/modules/auth/service";
import { verifySession } from "@/v2/modules/auth/session";
import { authorize } from "@/v2/modules/auth/access";
import Customers from "@/v2/app/customers/customers";

export const dynamic = "force-dynamic";
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ targetTenantId?: string | string[] }> }) {
  const tokens = (await cookies()).getAll(SESSION_COOKIE);
  if (tokens.length !== 1) redirect("/v2/login");
  let principal;
  try {
    const { dependencies: deps } = authRuntime();
    const verified = await verifySession(tokens[0].value, deps.sessions, deps.access);
    if (await authorize(verified, "auth:session", verified.scope, deps.access, verified.tenantId)) principal = verified;
  }
  catch (error) {
    if (loginFailure(error).kind === "AUTHENTICATION_UNAVAILABLE") return <main><h1>Clienti</h1><p role="alert">Accesso temporaneamente non disponibile.</p></main>;
  }
  if (!principal) redirect("/v2/login");
  const { targetTenantId } = await searchParams;
  const target = typeof targetTenantId === "string" ? targetTenantId : undefined;
  return <main style={{ maxWidth: "64rem", margin: "auto", padding: "2rem" }}>
    <a href="/v2/dashboard">← Dashboard</a><h1>Clienti</h1><p>Anagrafica dei soggetti, senza dati di fornitura.</p>
    {principal.scope === "PLATFORM" && <form method="get"><label>Azienda di destinazione (identificativo)
      <input name="targetTenantId" required maxLength={128} defaultValue={target} /></label><button>Seleziona azienda</button></form>}
    {principal.scope === "PLATFORM" && !target ? <p>Seleziona un’azienda. Il server ne verificherà l’accessibilità.</p> :
      <Customers key={target ?? "own"} target={target} />}
  </main>;
}
