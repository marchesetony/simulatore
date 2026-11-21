import type { IncomingMessage, ServerResponse } from "node:http";
import { handle, type ServiceEnvironment } from "./handler";

/** Vercel Node.js function (Build Output API): adapts the Node request to the Web Request the handler expects. */
export default async function entry(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = `https://${request.headers.host ?? "localhost"}${request.url ?? "/"}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value);
  const result = await handle(new Request(url, { method: request.method ?? "GET", headers }), process.env as ServiceEnvironment);
  response.statusCode = result.status;
  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(Buffer.from(await result.arrayBuffer()));
}
