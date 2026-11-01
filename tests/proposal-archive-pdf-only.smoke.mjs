import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tony (1/11): "le proposte solo in pdf, bisogna mettere il nome del cliente e la cte proposta".
const shell = readFileSync(new URL("../app/components/OperationalShell.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/proposal/route.ts", import.meta.url), "utf8");
const archive = shell.slice(shell.indexOf("function ProposalArchivePanel("), shell.indexOf("type CompanyProfileForm"));
assert.match(archive, /Scarica PDF/);
assert.doesNotMatch(archive, /"JSON"|"CSV"|"HTML"/, "the archive offers only the PDF");
assert.match(archive, /CTE proposta:/);
assert.match(archive, /<strong>\{customer\}<\/strong>/);
assert.doesNotMatch(shell, />JSON<\/button>|>CSV<\/button>|>HTML<\/button>/, "no other proposal format is offered");
assert.match(route, /label: await proposalLabel\(/);
assert.match(route, /customerName: shown\?\.customerName \|\| item\.customer\?\.displayName/);
console.log("proposal archive pdf only ok");
