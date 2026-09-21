// Compatibility route retained for generated route manifests; the scheduled contract is /api/cron/bill-retention.
// Authorization and CRON_SECRET enforcement are delegated to the canonical route below.
// @ts-expect-error Next route handlers are evaluated by the framework.
export { GET } from "../bill-retention/route.ts";
