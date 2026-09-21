function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",", 1)[0]?.trim();
  return first || null;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  let parsedOrigin: URL;
  try { parsedOrigin = new URL(origin); } catch { return false; }
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") return false;

  const requestUrl = new URL(request.url);
  const expectedHost = firstHeaderValue(request.headers.get("x-forwarded-host")) ?? request.headers.get("host")?.trim() ?? requestUrl.host;
  const expectedProtocol = firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? requestUrl.protocol.slice(0, -1);
  return parsedOrigin.host === expectedHost && parsedOrigin.protocol === `${expectedProtocol}:`;
}
