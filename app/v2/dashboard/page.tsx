import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authRuntime } from "@/v2/modules/auth/runtime";
import { SESSION_COOKIE } from "@/v2/modules/auth/http";
import { loginFailure } from "@/v2/modules/auth/service";
import { dashboardView, type DashboardView } from "@/v2/app/dashboard/access";
import Dashboard from "@/v2/app/dashboard/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const tokens = (await cookies()).getAll(SESSION_COOKIE);
  if (tokens.length !== 1) redirect("/v2/login");
  let view: DashboardView | null = null;
  try { view = await dashboardView(tokens[0].value, authRuntime().dependencies); }
  catch (error) {
    if (loginFailure(error).kind === "AUTHENTICATION_UNAVAILABLE") {
      return <main role="alert" style={{ padding: "3rem", maxWidth: "42rem", margin: "auto" }}>
        <h1>Accesso temporaneamente non disponibile</h1>
        <p>Non è stato possibile verificare l’accesso. Riprova più tardi.</p>
        <a href="/v2/login">Torna al login</a>
      </main>;
    }
  }
  if (!view) redirect("/v2/login");
  return <Dashboard view={view} />;
}
