import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { TenantRecordRepository } from "../persistence/types";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { PLATFORM_TENANT_ID } from "./types.ts";
import type { AccessDirectory, AccountStatus } from "./types";
import type { AuthRole } from "../auth/types";

interface LocalLogin {
  readonly authUserId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly userId: string | null;
  readonly displayName: string;
  readonly memberships: readonly { readonly tenantId: string; readonly role: AuthRole; readonly status: AccountStatus }[];
}

function hash(password: string, salt = randomBytes(16).toString("hex")): string { return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`; }
function matches(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  return timingSafeEqual(Buffer.from(digest, "hex"), scryptSync(password, salt, 32));
}

/**
 * Local-mode stand-in for Supabase Auth and the runtime_* tables, so the access screens work without a provider.
 * Local sign-in still goes through FOUNDATION_LOCAL_*; these logins only back the account screens.
 */
export class LocalAccessDirectory implements AccessDirectory {
  private readonly logins: TenantRecordRepository<LocalLogin>;
  constructor(logins: TenantRecordRepository<LocalLogin>) { this.logins = logins; }

  private async all() { return this.logins.list(PLATFORM_TENANT_ID); }
  private async byUser(userId: string) { return (await this.all()).find((record) => record.payload.userId === userId) ?? null; }
  private async update(record: Awaited<ReturnType<LocalAccessDirectory["all"]>>[number], payload: LocalLogin) { await this.logins.put({ tenantId: PLATFORM_TENANT_ID, recordId: record.recordId, payload, expectedVersion: record.version }); }

  async createLogin(input: { readonly email: string; readonly password: string; readonly displayName: string }) {
    if ((await this.all()).some((record) => record.payload.email === input.email)) throw new Error("ACCESS_EMAIL_TAKEN");
    const authUserId = randomUUID();
    await this.logins.put({ tenantId: PLATFORM_TENANT_ID, recordId: authUserId, payload: { authUserId, email: input.email, passwordHash: hash(input.password), userId: null, displayName: input.displayName, memberships: [] } });
    return { authUserId };
  }
  async linkUser(input: { readonly userId: string; readonly authUserId: string; readonly displayName: string }) {
    const record = await this.logins.get(PLATFORM_TENANT_ID, input.authUserId);
    if (!record) throw new Error("ACCESS_LOGIN_NOT_FOUND");
    await this.update(record, { ...record.payload, userId: input.userId, displayName: input.displayName });
  }
  async setMembership(input: { readonly userId: string; readonly tenantId: string; readonly role: AuthRole; readonly status: AccountStatus }) {
    const record = await this.byUser(input.userId);
    if (!record) throw new Error("ACCESS_LOGIN_NOT_FOUND");
    await this.update(record, { ...record.payload, memberships: [...record.payload.memberships.filter((item) => item.tenantId !== input.tenantId), { tenantId: input.tenantId, role: input.role, status: input.status }] });
  }
  async removeLogin(input: { readonly userId: string; readonly authUserId: string }) {
    const record = await this.logins.get(PLATFORM_TENANT_ID, input.authUserId);
    // The filesystem adapter has no delete; an unlinked, membership-less login cannot sign in to anything.
    if (record) await this.update(record, { ...record.payload, email: `removed+${record.payload.authUserId}@invalid.local`, userId: null, memberships: [] });
  }
  async loginFor(userId: string) {
    const record = await this.byUser(userId);
    return record ? { authUserId: record.payload.authUserId, email: record.payload.email } : null;
  }
  async verifyPassword(email: string, password: string) {
    const record = (await this.all()).find((item) => item.payload.email === email);
    return record && matches(password, record.payload.passwordHash) ? record.payload.authUserId : null;
  }
  async setPassword(authUserId: string, password: string) {
    const record = await this.logins.get(PLATFORM_TENANT_ID, authUserId);
    if (!record) throw new Error("ACCESS_LOGIN_NOT_FOUND");
    await this.update(record, { ...record.payload, passwordHash: hash(password) });
  }
}
