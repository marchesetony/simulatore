export type PunMarketDomain = "PUN_MONTHLY" | "PUN_F1" | "PUN_F2" | "PUN_F3";

export const PUN_REFRESH_FREQUENCY = "DAILY" as const;
export const PUN_REFRESH_CRON = "15 4 * * *" as const;
export const MINIMUM_PUN_HISTORY_MONTHS = 6 as const;
export const PUN_REFRESH_STALE_DAYS = 35 as const;
export const CALCULATED_PUN_DOMAINS: readonly PunMarketDomain[] = ["PUN_MONTHLY", "PUN_F1", "PUN_F2", "PUN_F3"];
export const AUTO_REFRESH_REGISTERED_PUN_DOMAINS = CALCULATED_PUN_DOMAINS;

export function assertPunRefreshCoverage(domains: readonly PunMarketDomain[] = CALCULATED_PUN_DOMAINS): void {
  const registered = new Set(AUTO_REFRESH_REGISTERED_PUN_DOMAINS);
  for (const domain of domains) if (!registered.has(domain)) throw new Error(`PUN_REFRESH_DOMAIN_UNREGISTERED:${domain}`);
}
