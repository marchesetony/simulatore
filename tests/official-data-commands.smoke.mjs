import assert from "node:assert/strict";
import { activeServiceJob, MANUAL_COMMANDS, serviceTriggerConfig, triggerServiceJob } from "../app/lib/official-monitor/service-trigger.ts";
import { officialDataOverview } from "../app/lib/official-monitor/service-overview.ts";

// Control Room → Dati ufficiali, comandi manuali (Tony 23/11/2026): the server starts the service's job with a secret the browser
// never sees, never twice, and the panel shows status, values and anomalies. Synthetic secret and stub service only.
const SECRET = "segreto-di-prova-0123456789abcdef";
const config = serviceTriggerConfig({ OFFICIAL_DATA_SERVICE_URL: "https://servizio.example/", OFFICIAL_DATA_SERVICE_SECRET: SECRET });

// 1. Configuration: https only, no credentials in the address, a real secret; otherwise the commands stay off.
assert.deepEqual(config, { baseUrl: "https://servizio.example", secret: SECRET });
assert.equal(serviceTriggerConfig({}), null);
assert.equal(serviceTriggerConfig({ OFFICIAL_DATA_SERVICE_URL: "http://servizio.example", OFFICIAL_DATA_SERVICE_SECRET: SECRET }), null);
assert.equal(serviceTriggerConfig({ OFFICIAL_DATA_SERVICE_URL: "https://u:p@servizio.example", OFFICIAL_DATA_SERVICE_SECRET: SECRET }), null);
assert.equal(serviceTriggerConfig({ OFFICIAL_DATA_SERVICE_URL: "https://servizio.example", OFFICIAL_DATA_SERVICE_SECRET: "corto" }), null);

// 2. Each button calls its job; ARERA and Terna are the two halves of "regulatory". Secret only in the Authorization header.
const calls = [];
const service = (respond) => async (url, init) => { calls.push({ url, auth: init.headers.authorization, redirect: init.redirect }); return respond(url, init); };
const ok = (outcome, extra = {}) => async () => new Response(JSON.stringify({ outcome, errors: [], ...extra }), { status: 200 });
for (const [command, query] of [["gme", "job=gme"], ["arera", "job=regulatory&scope=arera"], ["terna", "job=regulatory&scope=terna"]]) {
  const result = await triggerServiceJob({ command, config, fetchImpl: service(ok("OK")) });
  assert.equal(result.status, "COMPLETED"); assert.match(result.message, /modalità prova/);
  assert.equal(calls.at(-1).url, `https://servizio.example/api/run?${query}`);
  assert.equal(calls.at(-1).auth, `Bearer ${SECRET}`); assert.equal(calls.at(-1).redirect, "error");
  assert.ok(!JSON.stringify(result).includes(SECRET), "the secret never travels back");
}
assert.deepEqual(Object.keys(MANUAL_COMMANDS), ["gme", "arera", "terna"]);

// 3. Outcomes in Italian: anomalies, already running, refused, unreachable, still running.
const partial = await triggerServiceJob({ command: "terna", config, fetchImpl: service(ok("PARTIAL", { errors: ["tenant_x TERNA_CAPACITY:2026Q4:TERNA_CAPACITY_VALUE_NOT_FOUND"] })) });
assert.equal(partial.status, "COMPLETED"); assert.deepEqual(partial.errors, ["tenant_x TERNA_CAPACITY:2026Q4:TERNA_CAPACITY_VALUE_NOT_FOUND"]);
assert.equal((await triggerServiceJob({ command: "gme", config, fetchImpl: service(ok("ALREADY_RUNNING")) })).status, "ALREADY_RUNNING");
const refused = await triggerServiceJob({ command: "gme", config, fetchImpl: service(async () => new Response(JSON.stringify({ error: "CRON_UNAUTHORIZED" }), { status: 401 })) });
assert.equal(refused.status, "FAILED"); assert.match(refused.message, /collegamento/);
assert.equal((await triggerServiceJob({ command: "gme", config, fetchImpl: service(async () => { throw new TypeError("fetch failed"); }) })).status, "FAILED");
const slow = service((url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
const alive = setTimeout(() => undefined, 2000); // AbortSignal.timeout does not keep the test process alive by itself
const running = await triggerServiceJob({ command: "gme", config, fetchImpl: slow, timeoutMs: 20 });
clearTimeout(alive);
assert.equal(running.status, "RUNNING"); assert.match(running.message, /ancora lavorando/);

// 4. Never twice: a second command on the same service job while the first is in flight is refused here.
let release;
const held = service(() => new Promise((resolve) => { release = () => resolve(new Response(JSON.stringify({ outcome: "OK", errors: [] }), { status: 200 })); }));
const first = triggerServiceJob({ command: "arera", config, fetchImpl: held });
const second = await triggerServiceJob({ command: "terna", config, fetchImpl: service(ok("OK")) });
assert.equal(second.status, "ALREADY_RUNNING");
release(); assert.equal((await first).status, "COMPLETED");
assert.equal((await triggerServiceJob({ command: "terna", config, fetchImpl: service(ok("OK")) })).status, "COMPLETED", "free again once the first ended");

// 5. The service's lease: active until its expiry.
const locks = (payload) => ({ get: async (tenantId, recordId) => tenantId === "tenant_piattaforma" && recordId === "svclock_regulatory" ? { payload } : null });
assert.deepEqual(await activeServiceJob(locks({ owner: "svc_regulatory_1", expiresAt: "2026-11-23T13:10:00.000Z" }), "regulatory", "2026-11-23T13:01:00.000Z"), { job: "regulatory", since: "2026-11-23T13:00:00.000Z", until: "2026-11-23T13:10:00.000Z" });
assert.equal(await activeServiceJob(locks({ owner: "svc_regulatory_1", expiresAt: "2026-11-23T13:00:20.000Z" }), "regulatory", "2026-11-23T13:01:00.000Z"), null);
assert.equal(await activeServiceJob(locks({ owner: "x", expiresAt: "2026-11-23T13:10:00.000Z" }), "gme", "2026-11-23T13:01:00.000Z"), null);

// 6. Panel model: a Terna-only run updates the Terna card (with its values), the ARERA card keeps the last run that covered ARERA.
const base = { mode: "DRY_RUN", identity: "user_svc-dati-ufficiali", nextCheckAt: "2026-11-24T03:40:00.000Z" };
const full = { ...base, runId: "r1", job: "regulatory", startedAt: "2026-11-23T03:40:35.868Z", finishedAt: "2026-11-23T03:40:55.710Z", outcome: "PARTIAL", errors: ["tenant_energia-priva TERNA_CAPACITY:2026Q4:TERNA_CAPACITY_VALUE_NOT_FOUND"], summary: { tenants: [{ tenantId: "tenant_energia-priva", arera: "SUCCESS", capacity: "SUCCESS", terna: "PARTIAL_FAILURE", tide: "SUCCESS", errors: [] }] } };
const terna = { ...base, runId: "r2", job: "regulatory", startedAt: "2026-11-23T13:05:00.000Z", finishedAt: "2026-11-23T13:05:12.000Z", outcome: "OK", errors: [], summary: { scope: "terna", tenants: [{ tenantId: "tenant_energia-priva", arera: "SKIPPED", capacity: "SKIPPED", terna: "SUCCESS", tide: "SUCCESS", errors: [] }], acquired: [{ tenantId: "tenant_energia-priva", authority: "TERNA", identifier: "TERNA_CAPACITY_MARKET_2026Q4", component: "CAPACITY_MARKET_OFF_PEAK", customerScope: "DOMESTIC_RESIDENT_BT", effectiveFrom: "2026-10-01", effectiveTo: "2027-01-01", value: 9.876, unit: "EUR/MWH", source: "https://dati.terna.it/docs/cm.pdf", sha256: "a".repeat(64) }] } };
const market = { list: async () => [] };
const overview = await officialDataOverview({ now: "2026-11-23T13:06:00.000Z", runs: [full, terna], alerts: [], market, tenants: [{ tenantId: "tenant_piattaforma", label: "Archivio produttore" }, { tenantId: "tenant_energia-priva", label: "Energia Priva" }], coverage: null });
const card = (source) => overview.sources.find((item) => item.source === source);
assert.equal(card("TERNA").lastRun.startedAt, terna.startedAt); assert.equal(card("TERNA").status, "OK");
assert.deepEqual(card("TERNA").values.map((item) => [item.tenantLabel, item.value, item.unit, item.period]), [["Energia Priva", 9.876, "EUR/MWH", "dal 2026-10-01 al 2027-01-01"]]);
assert.equal(card("ARERA").lastRun.startedAt, full.startedAt); assert.equal(card("ARERA").status, "OK"); assert.deepEqual(card("ARERA").values, []);
assert.ok(card("ARERA").details.every((detail) => !/non eseguito in questo comando/.test(detail)));
console.log("official-data-commands smoke: OK");
