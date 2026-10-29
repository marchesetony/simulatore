import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tony (29/10): the simulation stays open while the operator moves between pages;
// it closes only with "Ricomincia" or when the operator exits.
const shell = readFileSync(new URL("../app/components/OperationalShell.tsx", import.meta.url), "utf8");
assert.match(shell, /<div hidden=\{section !== "quote"\}>\s*<QuickQuoteFlow/);
assert.doesNotMatch(shell, /section === "quote" \? <QuickQuoteFlow/);
console.log("quote stays open: ok");
