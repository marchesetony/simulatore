import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { snapshot } from "../modules/bills/snapshot.ts";
import { input } from "./bill-fixtures.mjs";

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
const uiRoot = fileURLToPath(new URL("../app/bills/", import.meta.url));
test("real rendered empty list has no fabricated bill or monetary values", () => {
  const { BillList } = component(resolve(uiRoot, "workspace.tsx"));
  const html = renderToStaticMarkup(createElement(BillList, { bills: [], busy: false, open: () => {} }));
  assert.match(html, /Nessuna bolletta presente/); assert.doesNotMatch(html, /€|POD|demo|fixture/i);
});
test("rendered detail distinguishes null from zero and contains only supported sections", () => {
  const { BillDetail } = component(resolve(uiRoot, "detail.tsx"));
  const bill = snapshot(input({ declaredDocumentTotal: null, lines: [] }),
    { id: "b", tenantId: "tenant_test", customerId: "c", supplyId: "s" });
  const html = renderToStaticMarkup(createElement(BillDetail, { bill, edit: () => {} }));
  assert.match(html, /Totale dichiarato dal documento/); assert.match(html, /Totale ricostruito/);
  assert.match(html, /Non noto/); assert.match(html, /Non acquisito/);
  assert.doesNotMatch(html, /0,00 €|Offerta attuale|confidence|fingerprint|provider|tenant_test/i);
});
test("rendered manual form has no client-controlled derived state or ownership update", () => {
  const { BillForm } = component(resolve(uiRoot, "bill-form.tsx"));
  const bill = snapshot(input(), { id: "b", tenantId: "tenant_test", customerId: "c", supplyId: "s" });
  const html = renderToStaticMarkup(createElement(BillForm, { initial: bill, customers: [], supplies: [], busy: false, save: async () => {}, cancel: () => {} }));
  for (const key of ["tenantId", "customerId", "supplyId", "id", "role", "permissions", "validationStatus", "completenessStatus", "reconstructedTotal"]) {
    assert.ok(!html.includes(`name="${key}"`));
  }
  assert.match(html, /method="post"/); assert.match(html, /al \(incluso\)/);
});
test("new domain has no current-market dependency, network acquisition or hardcoded reference rates", () => {
  // Architectural negative check supplements behavioral snapshot/pure-reconciliation tests.
  const root = fileURLToPath(new URL("../modules/bills/", import.meta.url));
  const domain = readdirSync(root).filter(name => name.endsWith(".ts")).map(name => readFileSync(resolve(root, name), "utf8")).join("\n");
  assert.doesNotMatch(domain, /(?:PUN|ARERA|GME|Terna|real-bill|synthetic-fixtures|node:fs|fetch\s*\()/);
});
