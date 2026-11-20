import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tony (31/10, "Operazione non disponibile. Codice SOURCE_BILL_VOLTAGE_MISMATCH"): "quale è il motivo, deve scrivere in
// italiano se non ha la cte adeguata ed eventualmente chiedere quale usare, aggiungi qualche tasto per selezionare".
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const driven = read("../app/lib/calculation/bill-driven.ts");
// The offers are chosen on the same voltage the calculation checks (the bill's trusted supply context).
assert.match(driven, /supplyContext\?\.voltageLevel \?\? contract\.supply\.voltageLevel \?\? \(inferredLowVoltage/);
const client = read("../app/lib/ui/client.ts");
assert.match(client, /SOURCE_BILL_VOLTAGE_MISMATCH: "La tensione della bolletta/);
assert.match(client, /Operazione non riuscita \(codice \$\{code\}\)/);
assert.doesNotMatch(client, /return messages\[code\] \?\? `Operazione non disponibile/);
const flow = read("../app/components/QuickQuoteFlow.tsx");
// A failed calculation keeps the CTEs on screen with one button each.
assert.match(flow, /Scegli quale CTE usare per questa bolletta/);
assert.match(flow, /onPick\(item\.archiveId\)/);
assert.match(flow, /Il calcolo con \$\{anchor\.supplier\}/);
console.log("source bill voltage choice ok");
