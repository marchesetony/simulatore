import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (fs.existsSync(fileURLToPath(candidate))) return nextResolve(pathToFileURL(fileURLToPath(candidate)).href, context);
  }
  return nextResolve(specifier, context);
}
