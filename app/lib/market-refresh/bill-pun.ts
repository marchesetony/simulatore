import type { RuntimeRepositories } from "../persistence/adapter";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { runPunMarketRefresh } from "./service.ts";

/** On-demand GME PUN refresh for a bill being read, with the same stores the cron uses. */
export function billPunRefresh(repositories: RuntimeRepositories, tenantId: string): (() => Promise<unknown>) | null {
  const { marketRefreshState, marketRefreshRuns, marketRefreshLocks } = repositories;
  if (!marketRefreshState || !marketRefreshRuns || !marketRefreshLocks) return null;
  return () => runPunMarketRefresh({ tenantId, repositories: { marketArchiveRepository: repositories.marketArchiveRepository, marketRefreshState, marketRefreshRuns, marketRefreshLocks }, trigger: "MANUAL" });
}
