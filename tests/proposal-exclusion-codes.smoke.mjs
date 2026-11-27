import assert from "node:assert/strict";
import { assertExclusion } from "../app/lib/proposal/integrity.ts";

// Tony (31/10, bolletta MACRI, "Scarica la proposta in PDF"): "Operazione non disponibile. Codice COMPARISON_EXCLUSION_INVALID".
// A CTE left out by the company's commercial rules, or without supplier name or offer code, must not stop the proposal.
const base = { archiveId: "a1", cteId: "c1", vector: "EE", supplier: "Fornitore", offerCode: "X1", cteVersion: null, message: "left out" };
for (const code of ["CTE_COMMERCIAL_BLOCKED", "CTE_COMMERCIAL_DELETED", "CTE_EXPIRED"]) assert.doesNotThrow(() => assertExclusion({ ...base, code }, "EE"), code);
assert.doesNotThrow(() => assertExclusion({ ...base, code: "CTE_EXPIRED", supplier: "", offerCode: "" }, "EE"), "empty supplier and offer code");
assert.throws(() => assertExclusion({ ...base, code: "NOT_A_CODE" }, "EE"));
console.log("PROPOSAL_EXCLUSION_CODES=PASS");
