import "server-only";
import { authorize } from "../auth/access";
import { verifySession } from "../auth/session";
import type { AuthDependencies } from "../auth/service";
import type { BillPermission } from "../auth/types";
import { BillError } from "./types";

/** Same verified-session/active-target policy as Customer V2. */
export async function billTenant(auth: AuthDependencies, token: string, permission: BillPermission, target?: string) {
  const principal = await verifySession(token, auth.sessions, auth.access);
  const tenant = principal.scope === "TENANT" ? principal.tenantId : target;
  if (!tenant || !/^tenant_[a-z0-9-]{1,120}$/.test(tenant) ||
      (principal.scope === "TENANT" && target !== undefined && target !== tenant) ||
      !await authorize(principal, permission, "TENANT", auth.access, tenant)) throw new BillError("DENIED");
  return tenant;
}
