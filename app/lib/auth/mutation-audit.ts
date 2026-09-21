import type { AuthenticatedPrincipal } from "./types.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { recordRuntimeAudit } from "../persistence/audit.ts";

export async function recordMutationAudit(input: {
  readonly principal: AuthenticatedPrincipal;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly targetUserId?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}): Promise<void> {
  await recordRuntimeAudit({
    tenantId: input.principal.tenantId,
    principal: input.principal,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: "ALLOWED",
    correlationId: `foundation-${input.action.toLowerCase()}`,
    metadata: { ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}), ...(input.metadata ?? {}) },
  });
}
