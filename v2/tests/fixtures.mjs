export const credentials = { email: "test@example.test", password: "synthetic-password" };
export const assignment = (role = "TENANT_ADMIN") => ({
  id: "assignment-test", user_id: "user_test", role, status: "ACTIVE",
  scope: role === "PLATFORM_OWNER" ? "PLATFORM" : "TENANT",
  tenant_id: role === "PLATFORM_OWNER" ? null : "tenant_test",
  permissions: ["auth:login", "auth:session"],
});

export function fixture(rows = [assignment()]) {
  const stored = new Map();
  const deps = {
    provider: { verify: async () => "provider-user" },
    access: {
      identity: async authUserId => ({ authUserId, userId: "user_test" }),
      assignments: async () => rows,
      legacyRoles: async () => [],
      tenantActive: async tenantId => tenantId === "tenant_test",
    },
    sessions: {
      insert: async row => { stored.set(row.sessionHash, row); },
      find: async hash => stored.get(hash) ?? null,
    },
    sessionSeconds: 300,
  };
  return { deps, stored, rows };
}
