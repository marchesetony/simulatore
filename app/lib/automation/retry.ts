export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio?: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly isRetryable?: (error: unknown) => boolean;
}

export interface RetryResult<T> {
  readonly value: T;
  readonly attempts: number;
}

export class AutomationRetryExhausted extends Error {
  readonly attempts: number;
  readonly lastError: unknown;
  constructor(attempts: number, lastError: unknown) {
    super("AUTOMATION_RETRY_EXHAUSTED");
    this.name = "AutomationRetryExhausted";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

const NON_RETRYABLE = /(?:UNAUTHORIZED|FORBIDDEN|SCHEMA|SEMANTIC|INVALID|NOT_FOUND|REVIEW_REQUIRED|PERSISTENCE_VERSION_CONFLICT|PERSISTENCE_APPEND_ONLY_CONFLICT)/i;
const RETRYABLE = /(?:TIMEOUT|TIMED_OUT|NETWORK|ECONN|5\d\d|FETCH_FAILED|TEMPORARY|RATE_LIMIT|429|503|504)/i;

export function isRetryableAutomationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (NON_RETRYABLE.test(message)) return false;
  return RETRYABLE.test(message);
}

export function retryDelayMs(attempt: number, policy: Pick<RetryPolicy, "baseDelayMs" | "maxDelayMs" | "jitterRatio">): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = policy.jitterRatio === undefined ? 0 : exponential * policy.jitterRatio * 0.5;
  return Math.max(0, Math.round(exponential - jitter + Math.random() * 2 * jitter));
}

export async function withBoundedRetry<T>(operation: (attempt: number) => Promise<T>, policy: RetryPolicy): Promise<RetryResult<T>> {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 8) throw new Error("RETRY_POLICY_INVALID");
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try { return { value: await operation(attempt), attempts: attempt }; }
    catch (error) {
      lastError = error;
      const retryable = policy.isRetryable?.(error) ?? isRetryableAutomationError(error);
      if (!retryable || attempt >= policy.maxAttempts) break;
      const delay = retryDelayMs(attempt, policy);
      if (delay > 0) await (policy.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(delay);
    }
  }
  throw new AutomationRetryExhausted(policy.maxAttempts, lastError);
}
