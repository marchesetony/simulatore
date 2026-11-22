// Build of the independent official data service (Tony 21/11/2026, opzione A) with the Vercel Build Output API:
// one Node.js function (api/run) and its scheduled jobs. Only the modules reachable from src/vercel-entry.ts are transpiled and
// shipped; the build stops if any of them belongs to the commercial application (login, CTE, bill reading, calculation
// engines, proposals, persistence adapter of the app, UI).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const require = createRequire(import.meta.url);
let ts;
try { ts = require("typescript"); } catch { ts = createRequire(path.join(repo, "package.json"))("typescript"); }

/** Modules of the commercial application that the service must never contain. */
export const FORBIDDEN = [
  /^app\/lib\/cte\//, /^app\/lib\/ingestion\/(?!document-numeric-evidence\.ts$)/, /^app\/lib\/reading\//, /^app\/lib\/auth\/(?!types\.ts$)/,
  /^app\/lib\/calculation\/(?!regulatory-timeline\.ts$)/, /^app\/lib\/quote\//, /^app\/lib\/proposal\//, /^app\/lib\/eligibility\//,
  /^app\/lib\/hierarchy\//, /^app\/lib\/production\//, /^app\/lib\/persistence\/(?!types\.ts$)/, /^app\/lib\/foundation\/(?:real-bill|bill-)/,
  /^app\/lib\/comparison\//, /^app\/lib\/v3\//, /^app\/components\//, /^app\/api\//, /^app\/lib\/company\//,
];

function resolveSpecifier(from, specifier) {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  throw new Error(`UNRESOLVED ${specifier} from ${path.relative(repo, from)}`);
}

/** Runtime imports only (type-only imports are erased by the transpiler and never shipped). */
export function runtimeClosure(entry) {
  const seen = new Map();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    const output = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false, isolatedModules: true } }).outputText;
    const imports = [];
    const pattern = /(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
    for (const match of output.matchAll(pattern)) imports.push(match[1] ?? match[2]);
    const rewritten = output.replace(pattern, (whole, a, b) => {
      const specifier = a ?? b;
      const target = resolveSpecifier(file, specifier);
      let relative = path.relative(path.dirname(file), target).replace(/\.tsx?$/, ".js");
      if (!relative.startsWith(".")) relative = `./${relative}`;
      return whole.replace(specifier, relative);
    });
    seen.set(file, rewritten);
    for (const specifier of imports) stack.push(resolveSpecifier(file, specifier));
  }
  return seen;
}

export function build({ outDir = path.join(here, ".vercel", "output") } = {}) {
  const entry = path.join(here, "src", "vercel-entry.ts");
  const closure = runtimeClosure(entry);
  const files = [...closure.keys()].map((file) => path.relative(repo, file)).sort();
  const forbidden = files.filter((file) => FORBIDDEN.some((rule) => rule.test(file)));
  if (forbidden.length) throw new Error(`Modules of the commercial application in the service:\n${forbidden.join("\n")}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const func = path.join(outDir, "functions", "api", "run.func");
  for (const [file, code] of closure) {
    const target = path.join(func, path.relative(repo, file)).replace(/\.tsx?$/, ".js");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, code);
  }
  // fflate (PDF streams) and postgres (database client): the only external packages, pure JavaScript without dependencies.
  let fflate;
  try { fflate = path.dirname(require.resolve("fflate/package.json")); } catch { fflate = path.dirname(createRequire(path.join(repo, "package.json")).resolve("fflate/package.json")); }
  fs.cpSync(fflate, path.join(func, "node_modules", "fflate"), { recursive: true });
  // postgres (porsager): database client of the service role svc_dati_ufficiali (Fase B), pure JavaScript without dependencies.
  const postgresDir = path.join(here, "node_modules", "postgres");
  if (!fs.existsSync(path.join(postgresDir, "package.json"))) throw new Error("postgres non installato: eseguire npm install in services/dati-ufficiali");
  const postgresPackage = JSON.parse(fs.readFileSync(path.join(postgresDir, "package.json"), "utf8"));
  if (postgresPackage.version !== "3.4.9" || Object.keys(postgresPackage.dependencies ?? {}).length) throw new Error(`postgres inatteso: ${postgresPackage.version}`);
  fs.cpSync(postgresDir, path.join(func, "node_modules", "postgres"), { recursive: true });
  fs.writeFileSync(path.join(func, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  fs.writeFileSync(path.join(func, "index.mjs"), `export { default } from "./services/dati-ufficiali/src/vercel-entry.js";\n`);
  fs.writeFileSync(path.join(func, ".vc-config.json"), JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 300, memory: 1024, regions: ["fra1"] }, null, 2));
  const { SCHEDULE } = { SCHEDULE: JSON.parse(fs.readFileSync(path.join(here, "schedule.json"), "utf8")) };
  fs.writeFileSync(path.join(outDir, "config.json"), JSON.stringify({ version: 3, crons: Object.values(SCHEDULE).map((job) => ({ path: job.path, schedule: job.cron })), routes: [{ src: "^/api/run$", dest: "/api/run" }, { src: "/(.*)", status: 404 }] }, null, 2));
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ files }, null, 2));
  return { files, outDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, outDir } = build();
  console.log(`servizio dati ufficiali: ${files.length} moduli in ${path.relative(process.cwd(), outDir)}`);
}
