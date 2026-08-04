import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/api/foundation/context/route.ts", import.meta.url), "utf8");
assert.match(source, /export async function GET\(request: Request\)/);
assert.match(source, /requestPrincipal\(request, "READ"\)/);
assert.match(source, /principal\.userId/); assert.match(source, /principal\.role/); assert.match(source, /principal\.tenantId/);
assert.match(source, /LOCAL_SYNTHETIC/); assert.match(source, /VERIFIED_SESSION/); assert.match(source, /runtimeMode === "invalid"/);
assert.match(source, /cache-control.*no-store/); assert.match(source, /vary.*Cookie, Authorization/);
assert.doesNotMatch(source, /searchParams|request\.json|x-foundation-tenant-id|x-foundation-role/);
assert.doesNotMatch(source, /sessionId|authorization:|cookie:/i);
assert.match(source, /AUTH_CONFIGURATION_INVALID/); assert.match(source, /authenticationState/); assert.match(source, /readiness/);
console.log("foundation-context smoke: ok (static server-context contract; no live HTTP authentication or cache execution)");
