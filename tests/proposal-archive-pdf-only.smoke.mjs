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

// Tony (1/11): "bisogna aggiungere tasto per eliminare la simulazione e una per inviarla al cliente dalla email dell'agente o
// altra posizione". Delete asks a confirmation on the page; send uses the device's share sheet, else the agent's mail program.
const client = readFileSync(new URL("../app/lib/ui/client.ts", import.meta.url), "utf8");
const byId = readFileSync(new URL("../app/api/proposal/[id]/route.ts", import.meta.url), "utf8");
assert.match(archive, /Invia al cliente/);
assert.match(archive, /Sì, elimina/);
assert.doesNotMatch(archive, /window\.confirm|confirm\(/, "no browser dialog");
assert.match(client, /export async function shareProposalPdf/);
assert.match(client, /navigator.*canShare|canShare\?\.\(\{ files: \[file\] \}\)/);
assert.match(client, /mailto:\?subject=/);
assert.match(byId, /export async function DELETE/);
assert.match(byId, /assertProposalInScope\(principal, repositories, readback\.proposal\)/);
console.log("proposal archive send and delete ok");
