const tenantPattern = /^tenant_[a-z0-9-]+$/;

export function configuredMarketRefreshTenants(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const raw = env.MARKET_REFRESH_TENANT_IDS?.trim();
  if (!raw && env.APP_RUNTIME_MODE === "production") throw new Error("MARKET_REFRESH_TENANTS_REQUIRED");
  const values = (raw ?? env.FOUNDATION_LOCAL_TENANT_ID ?? "tenant_local-demo").split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.some((value) => !tenantPattern.test(value))) throw new Error("MARKET_REFRESH_TENANTS_INVALID");
  return [...new Set(values)];
}

export function marketCronSecretConfigured(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.CRON_SECRET?.trim();
  if (!value) throw new Error("CRON_SECRET_REQUIRED");
  return value;
}

export function marketCronAuthorizationMatches(request: Request, secret: string): boolean { return request.headers.get("authorization") === `Bearer ${secret}`; }
