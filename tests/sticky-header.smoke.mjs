import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tony (1/11, "la top bar con il nome azienda deve stare fissa e il resto della pagina scorre"): the header is sticky and the
// menu stays beside the content, below the header's measured height.
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(css, /\.app-header \{ position:sticky; top:0; z-index:50;/);
assert.match(css, /\.app-sidebar \{ position:sticky; top:var\(--app-header-height, 80px\)/);
const shell = readFileSync(new URL("../app/components/OperationalShell.tsx", import.meta.url), "utf8");
assert.match(shell, /setProperty\("--app-header-height"/);
console.log("STICKY_HEADER=PASS");
