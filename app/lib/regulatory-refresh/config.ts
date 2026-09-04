const tenantPattern = /^tenant_[a-z0-9-]+$/;

export function configuredRefreshTenants(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const raw = env.REGULATORY_REFRESH_TENANT_IDS?.trim();
  if (!raw && env.APP_RUNTIME_MODE === "production") throw new Error("REGULATORY_REFRESH_TENANTS_REQUIRED");
  const values = (raw ?? env.FOUNDATION_LOCAL_TENANT_ID ?? "tenant_local-demo").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.some((value) => !tenantPattern.test(value))) throw new Error("REGULATORY_REFRESH_TENANTS_INVALID");
  return [...new Set(values)];
}

export function cronSecretConfigured(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.CRON_SECRET?.trim();
  if (!value) throw new Error("CRON_SECRET_REQUIRED");
  return value;
}

export function cronAuthorizationMatches(request: Request, secret: string): boolean {
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
