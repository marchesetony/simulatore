import { requestPrincipal } from "../../../lib/auth/request";
import { runtimeRepositories } from "../../../lib/persistence/adapter";
import { createUploadTarget } from "../../../lib/foundation/large-upload";

export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private" };

/** A signed URL where the browser sends a file larger than the hosting's request limit (see large-upload.ts). */
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await requestPrincipal(request, "OPERATE");
    return Response.json(await createUploadTarget(runtimeRepositories().documentStorage, principal.tenantId), { headers: HEADERS });
  } catch (error) {
    const code = error instanceof Error && error.message === "DIRECT_UPLOAD_UNAVAILABLE" ? "DIRECT_UPLOAD_UNAVAILABLE" : "UPLOAD_TARGET_FAILED";
    return Response.json({ error: { code, message: "Caricamento del file grande non disponibile" } }, { status: code === "DIRECT_UPLOAD_UNAVAILABLE" ? 501 : 403, headers: HEADERS });
  }
}
