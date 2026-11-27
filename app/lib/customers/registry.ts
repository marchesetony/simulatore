import { randomUUID } from "node:crypto";
import type { AuthenticatedPrincipal } from "../auth/types";
import type { TenantRecord, TenantRecordRepository } from "../persistence/types";
import type { BillDocument, BillRepository } from "../foundation/real-bill";
import type { BillVisibilityScope } from "../foundation/bill-visibility";
import type { CustomerBillFact } from "../ui/customer-registry";
import type { BillLinkRecord, BillReadSummary, CustomerCategory, CustomerContacts, CustomerKind, CustomerRecord, CustomerView, FieldChange, ProposalLink, RegistryAnomaly, RegistryChange, RegistryView, SimulationLink, SupplyHolder, SupplyRecord, SupplyTechnical } from "./model";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { authorizePrincipal } from "../auth/authorization.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { billInScope } from "../foundation/bill-visibility.ts";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { customerBillFact } from "../foundation/customer-registry.ts";

/**
 * Tony (24/11/2026, "FASE 2: ANAGRAFICA CLIENTI E POD"): persistent customer registry of a company.
 * - Customers, supplies (POD/PDR) and bill links are records of the user's company only (tenant in the key of every record).
 * - Bills are never changed: a link is its own record; simulations and proposals are reached through the bill they were
 *   computed on (sourceBill), so no calculation is touched.
 * - Nothing is merged by itself: a codice fiscale / partita IVA or a POD already registered is refused with the existing record,
 *   bills only suggest; a change of holder closes the current holder and opens a new one, the history stays.
 * - Every change is written in the record's history and in the audit trail.
 * - Visibility: company administrators see the whole company; directors and agents their commercial perimeter (the users of
 *   their branch, as for bills): customers they or their branch registered, or linked to bills they may see.
 * - Writes: every operating role may register customers; changes are allowed to directors and administrators, and to the
 *   agent who registered the record, always inside the perimeter.
 */

export class RegistryError extends Error {
  readonly status: number;
  readonly detail: Readonly<Record<string, unknown>>;
  constructor(code: string, status: number, detail: Readonly<Record<string, unknown>> = {}) { super(code); this.status = status; this.detail = detail; }
}

export interface RegistryRepositories {
  readonly customers: TenantRecordRepository<CustomerRecord>;
  readonly customerSupplies: TenantRecordRepository<SupplyRecord>;
  readonly customerBillLinks: TenantRecordRepository<BillLinkRecord>;
  readonly billRepository: Pick<BillRepository, "list" | "get">;
  readonly comparisonResults: Pick<TenantRecordRepository<unknown>, "list">;
  readonly proposals: Pick<TenantRecordRepository<unknown>, "list">;
}

export interface RegistryAuditEvent { readonly action: string; readonly resourceType: "CUSTOMER" | "SUPPLY" | "BILL_LINK"; readonly resourceId: string; readonly metadata: Readonly<Record<string, unknown>> }

export interface RegistryContext {
  readonly principal: AuthenticatedPrincipal;
  readonly scope: BillVisibilityScope;
  readonly repositories: RegistryRepositories;
  readonly now: () => string;
  readonly audit: (event: RegistryAuditEvent) => Promise<void>;
}

// ---------- normalisation and validation (what is typed, never guessed) ----------

const MAX_TEXT = 200;
function text(value: unknown, max = MAX_TEXT): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new RegistryError("CUSTOMER_FIELD_INVALID", 400);
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length > max) throw new RegistryError("CUSTOMER_FIELD_TOO_LONG", 400, { max });
  return trimmed || null;
}
export function normalizeTaxCode(value: unknown): string | null {
  const raw = text(value, 32);
  if (!raw) return null;
  const compact = raw.replace(/[\s.-]+/g, "").toUpperCase();
  if (!/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(compact) && !/^\d{11}$/.test(compact)) throw new RegistryError("CUSTOMER_TAX_CODE_INVALID", 400);
  return compact;
}
export function normalizeVatNumber(value: unknown): string | null {
  const raw = text(value, 32);
  if (!raw) return null;
  const compact = raw.replace(/[\s.-]+/g, "").toUpperCase().replace(/^IT(?=\d{11}$)/, "");
  if (!/^\d{11}$/.test(compact)) throw new RegistryError("CUSTOMER_VAT_NUMBER_INVALID", 400);
  return compact;
}
export function normalizeSupplyReference(vector: "EE" | "GAS", value: unknown): string {
  const raw = text(value, 40);
  if (!raw) throw new RegistryError("SUPPLY_REFERENCE_REQUIRED", 400);
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  if (vector === "EE" ? !/^IT\d{3}E[0-9A-Z]{8,9}$/.test(compact) : !/^\d{14}$/.test(compact)) throw new RegistryError(vector === "EE" ? "SUPPLY_POD_INVALID" : "SUPPLY_PDR_INVALID", 400);
  return compact;
}
function kindOf(value: unknown): CustomerKind { if (value === "PERSON" || value === "COMPANY") return value; throw new RegistryError("CUSTOMER_KIND_INVALID", 400); }
function categoryOf(value: unknown): CustomerCategory | null { if (value === null || value === undefined || value === "") return null; if (value === "RESIDENTIAL" || value === "NON_RESIDENTIAL") return value; throw new RegistryError("CUSTOMER_CATEGORY_INVALID", 400); }
function vectorOf(value: unknown): "EE" | "GAS" { if (value === "EE" || value === "GAS") return value; throw new RegistryError("SUPPLY_VECTOR_INVALID", 400); }
function emailOf(value: unknown): string | null { const raw = text(value, 120); if (raw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) throw new RegistryError("CUSTOMER_EMAIL_INVALID", 400); return raw; }
function phoneOf(value: unknown): string | null { const raw = text(value, 40); if (raw && !/^\+?[\d\s/.-]{6,}$/.test(raw)) throw new RegistryError("CUSTOMER_PHONE_INVALID", 400); return raw; }
function numberOf(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/\./g, "").replace(",", ".")) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new RegistryError("SUPPLY_NUMBER_INVALID", 400);
  return parsed;
}
function dateOf(value: unknown): string | null { const raw = text(value, 10); if (raw && !(/^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw)))) throw new RegistryError("DATE_INVALID", 400); return raw; }
function idOf(value: unknown, code: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new RegistryError(code, 400); return value; }
const nameKey = (value: string) => value.toLocaleLowerCase("it").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const addressKey = (value: string) => value.toLocaleLowerCase("it").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(via|v\.|viale|piazza|p\.zza|corso|c\.so)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function diff(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const key of Object.keys(after)) if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
  return changes;
}

// ---------- visibility and permissions ----------

const companyWide = (context: RegistryContext) => context.scope.role === "SUPER_ADMIN";
const canWriteAny = (context: RegistryContext) => authorizePrincipal(context.principal, "WRITE").allowed;

interface Loaded {
  readonly customers: readonly TenantRecord<CustomerRecord>[];
  readonly supplies: readonly TenantRecord<SupplyRecord>[];
  readonly links: readonly TenantRecord<BillLinkRecord>[];
  readonly bills: readonly BillDocument[];
  readonly visibleBillIds: ReadonlySet<string>;
}

async function load(context: RegistryContext): Promise<Loaded> {
  const tenantId = context.principal.tenantId;
  const own = <T extends { readonly tenantId: string }>(records: readonly TenantRecord<T>[]) => records.filter((record) => record.tenantId === tenantId && record.payload?.tenantId === tenantId);
  const [customers, supplies, links, bills] = await Promise.all([context.repositories.customers.list(tenantId), context.repositories.customerSupplies.list(tenantId), context.repositories.customerBillLinks.list(tenantId), context.repositories.billRepository.list(tenantId)]);
  const ownBills = bills.filter((bill) => bill.tenantId === tenantId);
  return { customers: own(customers), supplies: own(supplies), links: own(links), bills: ownBills, visibleBillIds: new Set(ownBills.filter((bill) => billInScope(bill, context.scope)).map((bill) => bill.id)) };
}

function visibleCustomerIds(context: RegistryContext, loaded: Loaded): Set<string> {
  if (companyWide(context)) return new Set(loaded.customers.map((record) => record.payload.customerId));
  const ids = new Set(loaded.customers.filter((record) => context.scope.ownerUserIds.has(record.payload.ownerUserId)).map((record) => record.payload.customerId));
  for (const link of loaded.links) if (loaded.visibleBillIds.has(link.payload.billId)) ids.add(link.payload.customerId);
  return ids;
}

function visibleSupplyIds(context: RegistryContext, loaded: Loaded, customers: ReadonlySet<string>): Set<string> {
  if (companyWide(context)) return new Set(loaded.supplies.map((record) => record.payload.supplyId));
  const ids = new Set<string>();
  for (const record of loaded.supplies) {
    const supply = record.payload;
    if (context.scope.ownerUserIds.has(supply.ownerUserId) || supply.holders.some((holder) => customers.has(holder.customerId))) ids.add(supply.supplyId);
  }
  for (const link of loaded.links) if (loaded.visibleBillIds.has(link.payload.billId)) ids.add(link.payload.supplyId);
  return ids;
}

function editable(context: RegistryContext, ownerUserId: string): boolean { return canWriteAny(context) || ownerUserId === context.principal.userId; }

/** A customer the user may see, or "not found" (nothing revealed about records outside the perimeter or the company). */
async function visibleCustomer(context: RegistryContext, loaded: Loaded, customerId: string): Promise<TenantRecord<CustomerRecord>> {
  const record = loaded.customers.find((item) => item.payload.customerId === customerId);
  if (!record || !visibleCustomerIds(context, loaded).has(customerId)) throw new RegistryError("CUSTOMER_NOT_FOUND", 404);
  return record;
}
async function visibleSupply(context: RegistryContext, loaded: Loaded, supplyId: string): Promise<TenantRecord<SupplyRecord>> {
  const record = loaded.supplies.find((item) => item.payload.supplyId === supplyId);
  if (!record || !visibleSupplyIds(context, loaded, visibleCustomerIds(context, loaded)).has(supplyId)) throw new RegistryError("SUPPLY_NOT_FOUND", 404);
  return record;
}

// ---------- commands ----------

function duplicateIdentifier(loaded: Loaded, taxCode: string | null, vatNumber: string | null, except: string | null): TenantRecord<CustomerRecord> | undefined {
  return loaded.customers.find((record) => record.payload.customerId !== except && ((taxCode && (record.payload.taxCode === taxCode || record.payload.vatNumber === taxCode)) || (vatNumber && (record.payload.vatNumber === vatNumber || record.payload.taxCode === vatNumber))));
}

function contactsOf(value: unknown): CustomerContacts {
  const input = (value ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || Array.isArray(input)) throw new RegistryError("CUSTOMER_FIELD_INVALID", 400);
  return { email: emailOf(input.email), phone: phoneOf(input.phone), postalAddress: text(input.postalAddress) };
}

export async function createCustomer(context: RegistryContext, input: Record<string, unknown>): Promise<CustomerRecord> {
  if (!authorizePrincipal(context.principal, "OPERATE").allowed) throw new RegistryError("AUTHORIZATION_DENIED", 403);
  const loaded = await load(context);
  const name = text(input.name);
  if (!name) throw new RegistryError("CUSTOMER_NAME_REQUIRED", 400);
  const taxCode = normalizeTaxCode(input.taxCode); const vatNumber = normalizeVatNumber(input.vatNumber);
  // Never two records for the same identifier, never a merge: the existing customer is returned to the caller instead.
  const existing = duplicateIdentifier(loaded, taxCode, vatNumber, null);
  if (existing) throw new RegistryError("CUSTOMER_ALREADY_REGISTERED", 409, visibleCustomerIds(context, loaded).has(existing.payload.customerId) ? { customerId: existing.payload.customerId } : {});
  const now = context.now(); const by = context.principal.userId;
  const customer: CustomerRecord = {
    customerId: `cus_${randomUUID().replace(/-/g, "")}`, tenantId: context.principal.tenantId, kind: kindOf(input.kind), name, taxCode, vatNumber,
    category: categoryOf(input.category), contacts: contactsOf(input.contacts), ownerUserId: by, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
    history: [{ at: now, by, action: "CREATED", changes: {}, reason: text(input.reason) }],
  };
  await context.audit({ action: "CUSTOMER_CREATED", resourceType: "CUSTOMER", resourceId: customer.customerId, metadata: { kind: customer.kind, withTaxCode: Boolean(taxCode), withVatNumber: Boolean(vatNumber) } });
  await context.repositories.customers.put({ tenantId: customer.tenantId, recordId: customer.customerId, payload: customer, now });
  return customer;
}

export async function updateCustomer(context: RegistryContext, customerId: string, input: Record<string, unknown>): Promise<CustomerRecord> {
  const loaded = await load(context);
  const record = await visibleCustomer(context, loaded, idOf(customerId, "CUSTOMER_NOT_FOUND"));
  if (!editable(context, record.payload.ownerUserId)) throw new RegistryError("AUTHORIZATION_DENIED", 403);
  const current = record.payload;
  const next = {
    kind: "kind" in input ? kindOf(input.kind) : current.kind,
    name: "name" in input ? text(input.name) : current.name,
    taxCode: "taxCode" in input ? normalizeTaxCode(input.taxCode) : current.taxCode,
    vatNumber: "vatNumber" in input ? normalizeVatNumber(input.vatNumber) : current.vatNumber,
    category: "category" in input ? categoryOf(input.category) : current.category,
    contacts: "contacts" in input ? contactsOf(input.contacts) : current.contacts,
  };
  if (!next.name) throw new RegistryError("CUSTOMER_NAME_REQUIRED", 400);
  const existing = duplicateIdentifier(loaded, next.taxCode, next.vatNumber, current.customerId);
  if (existing) throw new RegistryError("CUSTOMER_ALREADY_REGISTERED", 409, visibleCustomerIds(context, loaded).has(existing.payload.customerId) ? { customerId: existing.payload.customerId } : {});
  const changes = diff(current as unknown as Record<string, unknown>, next);
  if (!Object.keys(changes).length) return current;
  const now = context.now(); const by = context.principal.userId;
  const updated: CustomerRecord = { ...current, ...next, name: next.name, updatedAt: now, updatedBy: by, history: [...current.history, { at: now, by, action: "UPDATED", changes, reason: text(input.reason) }] };
  await context.audit({ action: "CUSTOMER_UPDATED", resourceType: "CUSTOMER", resourceId: current.customerId, metadata: { fields: Object.keys(changes) } });
  await context.repositories.customers.put({ tenantId: current.tenantId, recordId: current.customerId, payload: updated, expectedVersion: record.version, now });
  return updated;
}

function technicalOf(value: unknown, current?: SupplyTechnical): SupplyTechnical {
  const input = (value ?? {}) as Record<string, unknown>;
  if (typeof input !== "object" || Array.isArray(input)) throw new RegistryError("SUPPLY_FIELD_INVALID", 400);
  const pick = <K extends keyof SupplyTechnical>(key: K, read: (raw: unknown) => SupplyTechnical[K]) => key in input ? read(input[key]) : current ? current[key] : null as SupplyTechnical[K];
  return { voltageLevel: pick("voltageLevel", (raw) => text(raw, 20)), powerKw: pick("powerKw", numberOf), annualConsumption: pick("annualConsumption", numberOf), distributor: pick("distributor", (raw) => text(raw, 120)) };
}

export async function addSupply(context: RegistryContext, customerId: string, input: Record<string, unknown>): Promise<SupplyRecord> {
  const loaded = await load(context);
  const customer = await visibleCustomer(context, loaded, idOf(customerId, "CUSTOMER_NOT_FOUND"));
  if (!editable(context, customer.payload.ownerUserId)) throw new RegistryError("AUTHORIZATION_DENIED", 403);
  const vector = vectorOf(input.vector);
  const reference = normalizeSupplyReference(vector, input.reference);
  // One record per POD/PDR in the company: a POD already registered changes holder (changeHolder), it is never duplicated.
  const existing = loaded.supplies.find((record) => record.payload.reference === reference);
  if (existing) throw new RegistryError("SUPPLY_ALREADY_REGISTERED", 409, visibleSupplyIds(context, loaded, visibleCustomerIds(context, loaded)).has(existing.payload.supplyId) ? { supplyId: existing.payload.supplyId } : {});
  const now = context.now(); const by = context.principal.userId;
  const supply: SupplyRecord = {
    supplyId: `sup_${randomUUID().replace(/-/g, "")}`, tenantId: context.principal.tenantId, vector, reference, address: text(input.address), technical: technicalOf(input.technical),
    holders: [{ customerId: customer.payload.customerId, from: dateOf(input.from), to: null, recordedAt: now, recordedBy: by, reason: null }],
    ownerUserId: by, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by, history: [{ at: now, by, action: "CREATED", changes: { holder: { from: null, to: customer.payload.customerId } }, reason: text(input.reason) }],
  };
  await context.audit({ action: "SUPPLY_CREATED", resourceType: "SUPPLY", resourceId: supply.supplyId, metadata: { vector, customerId: customer.payload.customerId } });
  await context.repositories.customerSupplies.put({ tenantId: supply.tenantId, recordId: supply.supplyId, payload: supply, now });
  return supply;
}

export async function updateSupply(context: RegistryContext, supplyId: string, input: Record<string, unknown>): Promise<SupplyRecord> {
  const loaded = await load(context);
  const record = await visibleSupply(context, loaded, idOf(supplyId, "SUPPLY_NOT_FOUND"));
  if (!editable(context, record.payload.ownerUserId)) throw new RegistryError("AUTHORIZATION_DENIED", 403);
  const current = record.payload;
  const next = { address: "address" in input ? text(input.address) : current.address, technical: "technical" in input ? technicalOf(input.technical, current.technical) : current.technical };
  const changes = diff(current as unknown as Record<string, unknown>, next);
  if (!Object.keys(changes).length) return current;
  const now = context.now(); const by = context.principal.userId;
  const updated: SupplyRecord = { ...current, ...next, updatedAt: now, updatedBy: by, history: [...current.history, { at: now, by, action: "UPDATED", changes, reason: text(input.reason) }] };
  await context.audit({ action: "SUPPLY_UPDATED", resourceType: "SUPPLY", resourceId: current.supplyId, metadata: { fields: Object.keys(changes) } });
  await context.repositories.customerSupplies.put({ tenantId: current.tenantId, recordId: current.supplyId, payload: updated, expectedVersion: record.version, now });
  return updated;
}

/** Change of holder (voltura, subentro): the current holder is closed at `from`, the new one opens there; nothing is removed. */
export async function changeHolder(context: RegistryContext, supplyId: string, input: Record<string, unknown>): Promise<SupplyRecord> {
  const loaded = await load(context);
  const record = await visibleSupply(context, loaded, idOf(supplyId, "SUPPLY_NOT_FOUND"));
  if (!editable(context, record.payload.ownerUserId)) throw new RegistryError("AUTHORIZATION_DENIED", 403);
  const newHolder = await visibleCustomer(context, loaded, idOf(input.customerId, "CUSTOMER_NOT_FOUND"));
  const from = dateOf(input.from);
  if (!from) throw new RegistryError("HOLDER_CHANGE_DATE_REQUIRED", 400);
  const reason = text(input.reason);
  if (!reason) throw new RegistryError("HOLDER_CHANGE_REASON_REQUIRED", 400);
  const current = record.payload;
  const open = current.holders.find((holder) => holder.to === null);
  if (open?.customerId === newHolder.payload.customerId) throw new RegistryError("HOLDER_UNCHANGED", 409);
  if (open?.from && from <= open.from) throw new RegistryError("HOLDER_CHANGE_DATE_BEFORE_CURRENT", 400);
  const now = context.now(); const by = context.principal.userId;
  const holders: SupplyHolder[] = [...current.holders.map((holder) => holder === open ? { ...holder, to: from } : holder), { customerId: newHolder.payload.customerId, from, to: null, recordedAt: now, recordedBy: by, reason }];
  const updated: SupplyRecord = { ...current, holders, updatedAt: now, updatedBy: by, history: [...current.history, { at: now, by, action: "HOLDER_CHANGED", changes: { holder: { from: open?.customerId ?? null, to: newHolder.payload.customerId } }, reason }] };
  await context.audit({ action: "SUPPLY_HOLDER_CHANGED", resourceType: "SUPPLY", resourceId: current.supplyId, metadata: { previous: open?.customerId ?? null, next: newHolder.payload.customerId, from } });
  await context.repositories.customerSupplies.put({ tenantId: current.tenantId, recordId: current.supplyId, payload: updated, expectedVersion: record.version, now });
  return updated;
}

/** Links a bill the user may see to a customer and to one of the POD/PDR the customer holds or held; the bill is unchanged. */
export async function linkBill(context: RegistryContext, input: Record<string, unknown>): Promise<BillLinkRecord> {
  const loaded = await load(context);
  const billId = idOf(input.billId, "BILL_NOT_FOUND");
  if (!loaded.visibleBillIds.has(billId)) throw new RegistryError("BILL_NOT_FOUND", 404);
  const customer = await visibleCustomer(context, loaded, idOf(input.customerId, "CUSTOMER_NOT_FOUND"));
  const supply = await visibleSupply(context, loaded, idOf(input.supplyId, "SUPPLY_NOT_FOUND"));
  if (!supply.payload.holders.some((holder) => holder.customerId === customer.payload.customerId)) throw new RegistryError("SUPPLY_NOT_HELD_BY_CUSTOMER", 409);
  const bill = loaded.bills.find((item) => item.id === billId)!;
  const fact = customerBillFact(bill);
  // The POD read on the bill, when read, must be the POD of the link: a bill is never filed under another supply.
  if (fact.supplyReference && fact.supplyReference !== supply.payload.reference) throw new RegistryError("BILL_SUPPLY_MISMATCH", 409, { read: fact.supplyReference });
  const now = context.now(); const by = context.principal.userId;
  const existing = loaded.links.find((record) => record.payload.billId === billId);
  if (existing && existing.payload.customerId === customer.payload.customerId && existing.payload.supplyId === supply.payload.supplyId) return existing.payload;
  if (existing && !editable(context, customer.payload.ownerUserId)) throw new RegistryError("AUTHORIZATION_DENIED", 403);
  const change: RegistryChange = { at: now, by, action: existing ? "RELINKED" : "LINKED", changes: existing ? { customerId: { from: existing.payload.customerId, to: customer.payload.customerId }, supplyId: { from: existing.payload.supplyId, to: supply.payload.supplyId } } : {}, reason: text(input.reason) };
  const link: BillLinkRecord = { billId, tenantId: context.principal.tenantId, customerId: customer.payload.customerId, supplyId: supply.payload.supplyId, linkedAt: now, linkedBy: by, history: [...(existing?.payload.history ?? []), change] };
  await context.audit({ action: existing ? "BILL_RELINKED" : "BILL_LINKED", resourceType: "BILL_LINK", resourceId: billId, metadata: { customerId: link.customerId, supplyId: link.supplyId } });
  await context.repositories.customerBillLinks.put({ tenantId: link.tenantId, recordId: billId, payload: link, ...(existing ? { expectedVersion: existing.version } : {}), now });
  return link;
}

/**
 * New customer and POD from what a bill reads, linked to it, in one step the operator confirms. Read values only: what was not
 * read stays empty. If the codice fiscale / partita IVA or the POD is already registered nothing is created and the existing
 * record is returned to link to instead.
 */
export async function createFromBill(context: RegistryContext, input: Record<string, unknown>): Promise<{ readonly customer: CustomerRecord; readonly supply: SupplyRecord; readonly link: BillLinkRecord }> {
  const loaded = await load(context);
  const billId = idOf(input.billId, "BILL_NOT_FOUND");
  if (!loaded.visibleBillIds.has(billId)) throw new RegistryError("BILL_NOT_FOUND", 404);
  const fact = customerBillFact(loaded.bills.find((item) => item.id === billId)!);
  if (!fact.customerName) throw new RegistryError("BILL_HOLDER_NOT_READ", 409);
  if (!fact.supplyReference || !fact.vector) throw new RegistryError("BILL_SUPPLY_NOT_READ", 409);
  const isVat = Boolean(fact.taxIdentifier && /^\d{11}$/.test(fact.taxIdentifier));
  const customer = await createCustomer(context, { kind: input.kind ?? (isVat || fact.customerType === "NON_RESIDENTIAL" ? "COMPANY" : "PERSON"), name: fact.customerName, taxCode: isVat ? null : fact.taxIdentifier, vatNumber: isVat ? fact.taxIdentifier : null, category: fact.customerType, contacts: {}, reason: `da bolletta ${billId}` });
  const supply = await addSupply(context, customer.customerId, { vector: fact.vector, reference: fact.supplyReference, address: fact.supplyAddress, technical: {}, from: null, reason: `da bolletta ${billId}` });
  const link = await linkBill(context, { billId, customerId: customer.customerId, supplyId: supply.supplyId, reason: "creato dalla bolletta" });
  return { customer, supply, link };
}

// ---------- view ----------

function sourceBillId(payload: unknown, path: "result" | "proposal"): string | null {
  const value = path === "result" ? (payload as { result?: { normalizedInput?: { sourceBill?: { billId?: unknown } } } } | null)?.result?.normalizedInput?.sourceBill?.billId : (payload as { proposal?: { sourceBill?: { billId?: unknown } } } | null)?.proposal?.sourceBill?.billId;
  return typeof value === "string" ? value : null;
}

export async function registryView(context: RegistryContext): Promise<RegistryView> {
  const loaded = await load(context);
  const customerIds = visibleCustomerIds(context, loaded);
  const supplyIds = visibleSupplyIds(context, loaded, customerIds);
  const customers = loaded.customers.filter((record) => customerIds.has(record.payload.customerId)).map((record) => record.payload);
  const supplies = loaded.supplies.filter((record) => supplyIds.has(record.payload.supplyId)).map((record) => record.payload);
  const links = loaded.links.filter((record) => loaded.visibleBillIds.has(record.payload.billId)).map((record) => record.payload);
  const linkByBill = new Map(links.map((link) => [link.billId, link]));
  const tenantId = context.principal.tenantId;
  const [comparisons, proposals] = await Promise.all([context.repositories.comparisonResults.list(tenantId), context.repositories.proposals.list(tenantId)]);
  const simulations: SimulationLink[] = comparisons.filter((record) => record.tenantId === tenantId).flatMap((record) => {
    const link = linkByBill.get(sourceBillId(record.payload, "result") ?? "");
    const result = (record.payload as { comparisonId?: unknown; result?: { calculatedAt?: unknown } } | null);
    return link ? [{ comparisonId: typeof result?.comparisonId === "string" ? result.comparisonId : record.recordId, billId: link.billId, supplyId: link.supplyId, calculatedAt: typeof result?.result?.calculatedAt === "string" ? result.result.calculatedAt : null }] : [];
  });
  const proposalLinks: ProposalLink[] = proposals.filter((record) => record.tenantId === tenantId).flatMap((record) => {
    const link = linkByBill.get(sourceBillId(record.payload, "proposal") ?? "");
    return link ? [{ proposalId: record.recordId, billId: link.billId, supplyId: link.supplyId }] : [];
  });

  const facts = new Map<string, CustomerBillFact>(loaded.bills.filter((bill) => loaded.visibleBillIds.has(bill.id)).map((bill) => [bill.id, customerBillFact(bill)]));
  const views: CustomerView[] = customers.map((customer) => {
    const held = supplies.filter((supply) => supply.holders.some((holder) => holder.customerId === customer.customerId)).map((supply) => ({ ...supply, current: supply.holders.some((holder) => holder.customerId === customer.customerId && holder.to === null) }));
    const billIds = links.filter((link) => link.customerId === customer.customerId).map((link) => link.billId);
    return { customer, supplies: held, billIds, simulations: simulations.filter((item) => billIds.includes(item.billId)), proposals: proposalLinks.filter((item) => billIds.includes(item.billId)), canEdit: editable(context, customer.ownerUserId) };
  }).sort((a, b) => a.customer.name.localeCompare(b.customer.name, "it", { sensitivity: "base" }) || a.customer.customerId.localeCompare(b.customer.customerId));

  const bills: BillReadSummary[] = [...facts.values()].map((fact) => {
    const link = linkByBill.get(fact.billId);
    const suggested = customers.filter((customer) => (fact.taxIdentifier && (customer.taxCode === fact.taxIdentifier || customer.vatNumber === fact.taxIdentifier)) || (fact.supplyReference && supplies.some((supply) => supply.reference === fact.supplyReference && supply.holders.some((holder) => holder.customerId === customer.customerId)))).map((customer) => customer.customerId);
    return { billId: fact.billId, customerName: fact.customerName, taxIdentifier: fact.taxIdentifier, customerType: fact.customerType, vector: fact.vector, supplyReference: fact.supplyReference, supplyAddress: fact.supplyAddress, supplier: fact.supplier, periodStart: fact.periodStart ?? null, periodEnd: fact.periodEnd, linked: link ? { customerId: link.customerId, supplyId: link.supplyId } : null, suggestedCustomerIds: suggested };
  }).sort((a, b) => Number(Boolean(a.linked)) - Number(Boolean(b.linked)) || (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""));

  return { customers: views, orphanSupplies: supplies.filter((supply) => !supply.holders.some((holder) => holder.to === null)), bills, anomalies: registryAnomalies(customers, supplies, links, facts), canCreate: authorizePrincipal(context.principal, "OPERATE").allowed };
}

/** The anomalies of what the user may see; each is shown, none is corrected by itself. */
export function registryAnomalies(customers: readonly CustomerRecord[], supplies: readonly SupplyRecord[], links: readonly BillLinkRecord[], facts: ReadonlyMap<string, CustomerBillFact>): readonly RegistryAnomaly[] {
  const anomalies: RegistryAnomaly[] = [];
  const name = (id: string) => customers.find((customer) => customer.customerId === id)?.name ?? "cliente non visibile";
  for (const customer of customers) if (!customer.taxCode && !customer.vatNumber) anomalies.push({ code: "MISSING_TAX_ID", message: `${customer.name}: codice fiscale e partita IVA mancanti.`, customerIds: [customer.customerId], supplyIds: [], billIds: [] });
  for (const supply of supplies) {
    if (!supply.holders.some((holder) => holder.to === null)) anomalies.push({ code: "SUPPLY_WITHOUT_HOLDER", message: `${supply.vector === "GAS" ? "PDR" : "POD"} ${supply.reference}: nessun intestatario attuale.`, customerIds: [], supplyIds: [supply.supplyId], billIds: [] });
    const linked = links.filter((link) => link.supplyId === supply.supplyId);
    // Bills of this supply that read an identifier different from every holder's: a holder not registered, or a wrong link.
    const holderIds = new Set(supply.holders.flatMap((holder) => { const customer = customers.find((item) => item.customerId === holder.customerId); return customer ? [customer.taxCode, customer.vatNumber].filter((value): value is string => Boolean(value)) : []; }));
    const foreign = linked.filter((link) => { const read = facts.get(link.billId)?.taxIdentifier; return read && holderIds.size && !holderIds.has(read); });
    if (foreign.length) anomalies.push({ code: "SUPPLY_DIFFERENT_HOLDERS", message: `${supply.reference}: bollette intestate a un codice fiscale o partita IVA diverso da quello degli intestatari registrati (${[...new Set(foreign.map((link) => facts.get(link.billId)?.taxIdentifier))].join(", ")}).`, customerIds: supply.holders.map((holder) => holder.customerId), supplyIds: [supply.supplyId], billIds: foreign.map((link) => link.billId) });
    const addresses = linked.map((link) => facts.get(link.billId)?.supplyAddress).filter((value): value is string => Boolean(value));
    const differing = supply.address ? addresses.filter((address) => addressKey(address) !== addressKey(supply.address!)) : [];
    if (differing.length) anomalies.push({ code: "ADDRESS_MISMATCH", message: `${supply.reference}: indirizzo registrato "${supply.address}" diverso da quello letto in bolletta ("${[...new Set(differing)].join("\"; \"")}").`, customerIds: [], supplyIds: [supply.supplyId], billIds: linked.filter((link) => differing.includes(facts.get(link.billId)?.supplyAddress ?? "")).map((link) => link.billId) });
  }
  // The same POD read on bills of different holders while not all are registered as holders is covered above; here the bills
  // not yet linked whose POD is read under two different identifiers.
  const byReference = new Map<string, Set<string>>();
  for (const fact of facts.values()) if (fact.supplyReference && fact.taxIdentifier) byReference.set(fact.supplyReference, (byReference.get(fact.supplyReference) ?? new Set()).add(fact.taxIdentifier));
  for (const [reference, ids] of byReference) if (ids.size > 1 && !anomalies.some((item) => item.code === "SUPPLY_DIFFERENT_HOLDERS" && item.message.startsWith(reference))) {
    const supply = supplies.find((item) => item.reference === reference);
    anomalies.push({ code: "SUPPLY_DIFFERENT_HOLDERS", message: `${reference}: letto in bollette di intestatari diversi (${[...ids].join(", ")}); se è un cambio di intestatario va registrato.`, customerIds: [], supplyIds: supply ? [supply.supplyId] : [], billIds: [...facts.values()].filter((fact) => fact.supplyReference === reference).map((fact) => fact.billId) });
  }
  // Possible duplicates: same name (legal form aside) or same e-mail/phone on records with different or missing identifiers.
  const groups = new Map<string, CustomerRecord[]>();
  for (const customer of customers) {
    for (const key of [`n:${nameKey(customer.name)}`, customer.contacts.email ? `e:${customer.contacts.email.toLowerCase()}` : "", customer.contacts.phone ? `p:${customer.contacts.phone.replace(/\D/g, "")}` : ""].filter(Boolean)) groups.set(key, [...(groups.get(key) ?? []), customer]);
  }
  const reported = new Set<string>();
  for (const group of groups.values()) {
    const ids = [...new Set(group.map((customer) => customer.customerId))];
    if (ids.length < 2) continue;
    const key = ids.sort().join("|");
    if (reported.has(key)) continue;
    reported.add(key);
    anomalies.push({ code: "POSSIBLE_DUPLICATE", message: `Possibili doppioni da verificare: ${ids.map(name).join("; ")}. Non vengono uniti automaticamente.`, customerIds: ids, supplyIds: [], billIds: [] });
  }
  const unlinked = [...facts.values()].filter((fact) => !links.some((link) => link.billId === fact.billId));
  if (unlinked.length) anomalies.push({ code: "BILL_NOT_LINKED", message: unlinked.length === 1 ? "1 bolletta non ancora collegata a un cliente." : `${unlinked.length} bollette non ancora collegate a un cliente.`, customerIds: [], supplyIds: [], billIds: unlinked.map((fact) => fact.billId) });
  return anomalies;
}
