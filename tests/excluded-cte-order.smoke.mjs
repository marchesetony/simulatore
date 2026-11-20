import assert from "node:assert/strict";
// @ts-expect-error Node's strip-only test runner requires the explicit extension.
import { exclusionRank } from "../app/lib/quote/exclusion-order.ts";

// Tony (1/11, business bill 3.044 kWh/anno): "devono essere ordinate per tipologia se la bolletta è business prima le business
// ordinate da quella adeguata per vincoli sui consumi e a seguire le meno convenienti".
const ctes = [
  { name: "Casa Protetta", reasonCodes: ["CUSTOMER_LEGAL_TYPE_MISMATCH"], customer: "Consumer", consumption: null },
  { name: "Be Strong", reasonCodes: ["CONSUMPTION_THRESHOLD_MISMATCH"], customer: "Business", consumption: "> 60.000 kWh/anno" },
  { name: "Azienda Protetta", reasonCodes: ["MONTHLY_PROFILE_REQUIRED"], customer: "Business", consumption: null },
  { name: "Be Top", reasonCodes: ["CONSUMPTION_THRESHOLD_MISMATCH"], customer: "Business", consumption: "> 10.000 kWh/anno" },
  { name: "Be Smart", reasonCodes: ["CONSUMPTION_THRESHOLD_MISMATCH"], customer: "Consumer e Business", consumption: "> 40.000 kWh/anno" },
];
const order = (business) => [...ctes].map((cte) => ({ cte, rank: exclusionRank(cte, business, 3044) })).sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]).map((item) => item.cte.name);
assert.deepEqual(order(true), ["Azienda Protetta", "Be Top", "Be Smart", "Be Strong", "Casa Protetta"]);
assert.equal(order(false)[0], "Be Smart", "a household bill puts first the CTEs open to households");
assert.ok(order(false).indexOf("Azienda Protetta") > order(false).indexOf("Be Smart"), "business-only CTEs after");
console.log("EXCLUDED_CTE_ORDER=PASS");
