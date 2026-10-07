import "server-only";
import { authorize } from "../auth/access";
import { verifySession } from "../auth/session";
import type { AuthDependencies } from "../auth/service";
import type { SimulationPermission } from "../auth/types";
import { SimulationError } from "./types";

export async function simulationTenant(auth: AuthDependencies, token: string, permission: SimulationPermission, target?: string): Promise<string> {
  const principal = await verifySession(token, auth.sessions, auth.access);
  const tenant = principal.scope === "TENANT" ? principal.tenantId : target;
  if (!tenant || !/^tenant_[a-z0-9-]{1,120}$/.test(tenant) ||
    (principal.scope === "TENANT" && target !== undefined && target !== tenant) ||
    !await authorize(principal, permission, "TENANT", auth.access, tenant)) throw new SimulationError("DENIED");
  return tenant;
}
