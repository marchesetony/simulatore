import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Test-only loader: resolves extensionless imports to .ts or .tsx and compiles .tsx with the project's JSX setting
// (react-jsx), so a React component can be rendered to HTML with react-dom/server in a smoke test.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    for (const extension of [".ts", ".tsx"]) {
      const candidate = new URL(`${specifier}${extension}`, context.parentURL);
      if (fs.existsSync(fileURLToPath(candidate))) return nextResolve(pathToFileURL(fileURLToPath(candidate)).href, context);
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  const source = fs.readFileSync(fileURLToPath(url), "utf8");
  const { outputText } = ts.transpileModule(source, { fileName: fileURLToPath(url), compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false } });
  return { format: "module", source: outputText, shortCircuit: true };
}
