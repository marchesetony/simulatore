export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, private" };

// Tony (10/11/2026): the legacy "Svuota archivio" (31/10) is disabled. It removed every bill and CTE of the company in one
// go, without the per-document checks of DELETE /api/bills/[id] (bills linked to proposals, outcome per document). Any
// request, direct ones included, is refused here without reading or deleting anything; company-archive-purge.ts is no
// longer reachable from the app.
export async function POST(): Promise<Response> {
  return Response.json({ bills: 0, ctes: 0, cteDocuments: 0, failed: 0, error: { code: "ARCHIVE_PURGE_DISABLED", message: "Lo svuotamento dell'archivio è disattivato: le bollette si cancellano una per una da «Bollette archiviate»." } }, { status: 410, headers: HEADERS });
}
