// Tony (12/11, opzione A): "Archivio CTE" visibile a Direttore e Area Manager (ANALYST);
// permessi server invariati, scadenza/ricarico/assegnazioni riservati all'Amministratore.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shell = read("app/components/OperationalShell.tsx");
const list = (name) => JSON.parse(shell.match(new RegExp(`const ${name}: readonly string\\[\\] = (\\[[^\\]]*\\]);`))[1]);
const PLATFORM = list("PLATFORM_SECTIONS");
const SALES = list("SALES_SECTIONS");
const ADMIN = list("COMPANY_ADMIN_SECTIONS");
const MANAGER = list("COMPANY_MANAGER_SECTIONS");

// The menu rule as written in the shell, evaluated per role.
assert.match(shell, /const visibleSection = \(id: SectionId\): boolean => platformTenant \? PLATFORM_SECTIONS\.includes\(id\) : \(companyAdmin \? COMPANY_ADMIN_SECTIONS : context\?\.role === "ANALYST" \? COMPANY_MANAGER_SECTIONS : SALES_SECTIONS\)\.includes\(id\);/);
assert.match(shell, /const companyAdmin = context\?\.role === "ADMIN";/);
const menu = (role, tenantId = "tenant_x") => tenantId === "tenant_piattaforma" ? PLATFORM : role === "ADMIN" ? ADMIN : role === "ANALYST" ? MANAGER : SALES;

assert.deepEqual(menu("ADMIN"), ["quote", "proposals", "cte", "market", "chain", "access"], "Amministratore: menu invariato");
assert.deepEqual(menu("ANALYST"), ["quote", "proposals", "cte"], "Direttore/Area Manager: Archivio CTE in più");
assert.deepEqual(menu("VIEWER"), ["quote", "proposals"], "Agente: menu invariato");
assert.deepEqual(menu("ADMIN", "tenant_piattaforma"), ["dashboard", "access", "system"], "Piattaforma: invariata");
for (const role of ["ADMIN", "ANALYST", "VIEWER"]) for (const id of ["quote", "proposals"]) assert.ok(menu(role).includes(id), `${role} conserva ${id}`);
for (const id of ["market", "chain", "access"]) assert.ok(!menu("ANALYST").includes(id), `ANALYST non vede ${id}`);

// The panel keeps admin-only controls behind the ADMIN role and write controls behind readonly.
assert.match(shell, /section === "cte" \? <><CteIngestionPanel readonly=\{readonly\} canAdjust=\{context\?\.role === "ADMIN"\} \/><\/>/);
const panel = read("app/components/CteIngestionPanel.tsx");
assert.match(panel, /<ExpiryEditor record=\{record\} canEdit=\{canAdjust && !readonly\} \/>/);
assert.match(panel, /\{canAdjust && record\.commercialAdjustment \? <CommercialAdjustment/);
assert.match(read("app/components/CommercialDiscountPanel.tsx"), /if \(!loaded\?\.canManage\) return null;/);

// Server permissions unchanged: write for ADMIN/ANALYST, admin-only expiry/adjustment/assignments.
const auth = read("app/lib/auth/authorization.ts");
assert.match(auth, /access === "READ" \|\| access === "OPERATE" \|\| role === "ADMIN" \|\| role === "ANALYST" && access === "WRITE"/);
for (const route of ["app/api/cte/archive/[id]/expiry/route.ts", "app/api/cte/archive/[id]/adjustment/route.ts", "app/api/cte/assignments/route.ts"]) assert.match(read(route), /"ADMIN"/, `${route} resta ADMIN`);
console.log("cte-archive-menu-analyst: ok");
