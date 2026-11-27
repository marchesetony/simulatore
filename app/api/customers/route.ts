import { requestPrincipal } from "../../lib/auth/request";
import { AuthenticationError } from "../../lib/auth/errors";
import { runtimeRepositories } from "../../lib/persistence/adapter";
import { registryView } from "../../lib/customers/registry";
import { CUSTOMER_NO_STORE, registryContext, registryErrorResponse, runRegistryAction } from "../../lib/customers/http";

// Tony (24/11/2026, "FASE 2: ANAGRAFICA CLIENTI E POD"): persistent customer registry. Identity, company and commercial branch
// are checked on every request; reading and every change are decided by the server (app/lib/customers/registry.ts).
const MAX_BILLS = 500;

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "READ");
    const repositories = runtimeRepositories();
    if ((await repositories.billRepository.list(principal.tenantId)).length > MAX_BILLS) return Response.json({ error: { code: "CUSTOMER_REGISTRY_TOO_LARGE", message: `Le bollette superano ${MAX_BILLS}: l'anagrafica non viene mostrata per non presentarla incompleta.` } }, { status: 503, headers: CUSTOMER_NO_STORE });
    return Response.json(await registryView(await registryContext(principal, repositories)), { headers: CUSTOMER_NO_STORE });
  } catch (error) { return registryErrorResponse(error, AuthenticationError); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "OPERATE");
    const body = await request.json().catch(() => null);
    return Response.json(await runRegistryAction(await registryContext(principal, runtimeRepositories()), body), { headers: CUSTOMER_NO_STORE });
  } catch (error) { return registryErrorResponse(error, AuthenticationError); }
}
