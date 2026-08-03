import { readinessReport } from "../../../lib/readiness";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const report = readinessReport();
  return Response.json(report, { status: report.readiness ? 200 : 503, headers: { "cache-control": "no-store" } });
}
