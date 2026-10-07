import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { calculate } from "../modules/simulations/engine.ts";
import { snapshot } from "./simulation-fixtures.mjs";

function component(file) {
  const source = readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const renderedModule = { exports: {} }, require = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled)(name => {
    if (name.endsWith(".css")) return {};
    if (!name.startsWith(".")) return require(name);
    const base = resolve(dirname(file), name);
    return component(existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`);
  }, renderedModule, renderedModule.exports);
  return renderedModule.exports;
}
const uiRoot = fileURLToPath(new URL("../app/simulations/", import.meta.url));
test("rendered empty Simulation archive has no demo", () => {
  const { SimulationList } = component(resolve(uiRoot, "workspace.tsx"));
  const html = renderToStaticMarkup(createElement(SimulationList, { rows: [], open: () => {} }));
  assert.match(html, /Nessuna simulazione presente/); assert.doesNotMatch(html, /€|demo|fixture|PUN/i);
});
test("rendered result labels commercial scope exclusions and no full bill promise", () => {
  const Detail = component(resolve(uiRoot, "detail.tsx")).default, inputSnapshot = snapshot();
  const html = renderToStaticMarkup(createElement(Detail, { simulation: { inputSnapshot, result: calculate(inputSnapshot) } }));
  assert.match(html, /Simulazione commerciale/); assert.match(html, /regolate\/passanti/); assert.match(html, /imposte/);
  assert.match(html, /Costo commerciale candidato/); assert.match(html, /Confronto: Non disponibile/);
  assert.doesNotMatch(html, /totale bolletta|bolletta completa|confidence|fingerprint|provider diagnostics/i);
});
test("manual form has explicit units/applicability but no result or current cost authority", () => {
  const Form = component(resolve(uiRoot, "form.tsx")).default;
  const html = renderToStaticMarkup(createElement(Form, { bills: [], busy: false, create: async () => {} }));
  assert.match(html, /Applicabilità/); assert.match(html, /Unità/); assert.match(html, /method="post"/);
  for (const key of ["tenantId", "scope", "status", "result", "calculationVersion", "currentCost", "savingAmountCents"]) assert.ok(!html.includes(`name="${key}"`));
});
test("pure engine graph has no acquisition clock latest or V1 runtime dependencies", () => {
  const root = fileURLToPath(new URL("../modules/simulations/", import.meta.url));
  const source = ["engine.ts", "components.ts", "decimal.ts", "consumption.ts"].map(name => readFileSync(resolve(root, name), "utf8")).join("\n");
  assert.doesNotMatch(source, /fetch\s*\(|Date\.now|new Date\(\)|latest|node:fs|Math\.random|Math\.round|EPSILON|foundation/);
  assert.ok(readdirSync(root).every(name => !name.endsWith(".sql")));
});
