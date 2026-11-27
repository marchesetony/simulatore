import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tony (1/11): "questi dati non facciamoli vedere a tutti se vuole solo amministratore. creano confusione, partiamo dalla regola
// semplificare per evitare domande e confusione". The bill items left out of the comparison show only to the company
// administrator, and the customer's proposal never lists them.
const flow = readFileSync(new URL("../app/components/QuickQuoteFlow.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../app/components/OperationalShell.tsx", import.meta.url), "utf8");
assert.match(flow, /\{showExcluded && receipt\.excluded\?\.length \? <div className="quote-excluded">/);
assert.match(flow, /^\s*excluded: \[\],$/m);
assert.match(shell, /<QuickQuoteFlow readonly=\{operateReadonly\} showExcluded=\{companyAdmin\} \/>/);
assert.match(shell, /const companyAdmin = context\?\.role === "ADMIN";/);
console.log("excluded admin only ok");
