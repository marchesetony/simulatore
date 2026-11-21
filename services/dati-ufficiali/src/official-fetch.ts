import { createHash } from "node:crypto";
import { AutomationRetryExhausted, withBoundedRetry } from "../../../app/lib/automation/retry";

/**
 * Downloads from the official sources only (Tony 21/11/2026): https, hosts of GME, ARERA and Terna, no redirect to another
 * host, a time limit and a size limit. Every answer is recorded with its SHA-256 so the original document can be conserved.
 * A failed download is retried a bounded number of times (network errors, 429, 5xx); a refusal (403, 404) is not retried.
 */
export const OFFICIAL_HOSTS: readonly string[] = ["gme.mercatoelettrico.org", "www.mercatoelettrico.org", "mercatoelettrico.org", "www.arera.it", "arera.it", "dati.terna.it", "www.terna.it", "terna.it"];
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

export interface FetchedDocument {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly size: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
  readonly retrievedAt: string;
}
export type OfficialFetch = (url: string, init?: RequestInit) => Promise<Response>;

export function assertOfficialUrl(url: string): URL {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("OFFICIAL_URL_INVALID"); }
  if (parsed.protocol !== "https:" || !OFFICIAL_HOSTS.includes(parsed.hostname.toLowerCase()) || parsed.username || parsed.password || parsed.port) throw new Error(`OFFICIAL_HOST_NOT_ALLOWED:${parsed.hostname}`);
  return parsed;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A fetch limited to the official hosts, recording each successful answer. Same shape as fetch, so the existing readers use it. */
export function createOfficialFetch(input: { readonly fetchImpl?: typeof fetch; readonly now: () => string; readonly timeoutMs?: number; readonly retries?: number; readonly sleep?: (ms: number) => Promise<void> }): { readonly fetch: OfficialFetch; readonly recorded: FetchedDocument[]; readonly failures: { url: string; error: string }[] } {
  const doFetch = input.fetchImpl ?? fetch;
  const recorded: FetchedDocument[] = [];
  const failures: { url: string; error: string }[] = [];
  const once = async (url: string, init?: RequestInit): Promise<Response> => {
    assertOfficialUrl(url);
    const response = await doFetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(input.timeoutMs ?? 25_000), headers: { "User-Agent": "ServizioDatiUfficiali/1.0 (official-source-import)", ...(init?.headers as Record<string, string> | undefined) } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`OFFICIAL_HTTP_${response.status}`);
      const next = new URL(location, url).toString();
      assertOfficialUrl(next);
      return once(next, init);
    }
    if (response.status === 429 || response.status >= 500) throw new Error(`OFFICIAL_HTTP_${response.status}`);
    return response;
  };
  const officialFetch: OfficialFetch = async (url, init) => {
    try {
      const { value } = await withBoundedRetry(async () => {
        const response = await once(url, init);
        if ((init?.method ?? "GET").toUpperCase() === "HEAD") return response;
        const declared = Number(response.headers.get("content-length") ?? "0");
        if (declared > MAX_DOCUMENT_BYTES) throw new Error("OFFICIAL_DOCUMENT_TOO_LARGE");
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.byteLength > MAX_DOCUMENT_BYTES) throw new Error("OFFICIAL_DOCUMENT_TOO_LARGE");
        if (response.ok) recorded.push({ url, status: response.status, contentType: response.headers.get("content-type") ?? "", size: buffer.byteLength, sha256: sha256(buffer), bytes: buffer, retrievedAt: input.now() });
        return new Response(buffer, { status: response.status, headers: response.headers });
      }, { maxAttempts: input.retries ?? 3, baseDelayMs: 2_000, maxDelayMs: 15_000, jitterRatio: 0.2, sleep: input.sleep, isRetryable: (error) => /OFFICIAL_HTTP_(?:429|5\d\d)|TIMEOUT|TimeoutError|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(error instanceof Error ? `${error.name} ${error.message}` : String(error)) });
      return value;
    } catch (error) {
      const cause = error instanceof AutomationRetryExhausted ? error.lastError : error;
      const message = cause instanceof Error ? cause.message : String(cause);
      failures.push({ url, error: message.slice(0, 200) });
      throw cause instanceof Error ? cause : new Error(message);
    }
  };
  return { fetch: officialFetch, recorded, failures };
}

export async function fetchDocument(officialFetch: OfficialFetch, url: string, recorded: readonly FetchedDocument[]): Promise<FetchedDocument> {
  const response = await officialFetch(url);
  if (!response.ok) throw new Error(`OFFICIAL_HTTP_${response.status}`);
  const found = [...recorded].reverse().find((item) => item.url === url);
  if (found) return found;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { url, status: response.status, contentType: response.headers.get("content-type") ?? "", size: bytes.byteLength, sha256: sha256(bytes), bytes, retrievedAt: new Date().toISOString() };
}
