import assert from "node:assert/strict";
import { commercialDiscountAmount, parseCommercialDiscount } from "../app/lib/company/discount.ts";
import { withCommercialDiscount } from "../app/lib/quote/receipt.ts";
import { buildOrgChainIndex, nodeCanManageDiscount } from "../app/lib/hierarchy/service.ts";

// Tony (1/11): "un box che prevede di far risultare i preventivi che sono meno convenienti della bolletta di una percentuale e
// farli risultare migliori di una percentuale", "gestibile e visibile solo dall'amministratore dell'azienda e a cascata chi lui
// autorizza". Built as a real commercial discount: its own line on the quote and the proposal, never a hidden change.
const policy = { enabled: true, maxGapPercent: 5, targetSavingPercent: 2 };
assert.equal(commercialDiscountAmount(policy, 100, 104), 6, "104 € against a 100 € bill: discount to 98 €");
assert.equal(commercialDiscountAmount(policy, 100, 106), 0, "beyond the threshold no discount");
assert.equal(commercialDiscountAmount(policy, 100, 99), 0, "a quote already cheaper is left as it is");
assert.equal(commercialDiscountAmount({ ...policy, enabled: false }, 100, 104), 0);
assert.throws(() => parseCommercialDiscount({ enabled: true, maxGapPercent: 40, targetSavingPercent: 2 }, "2026-11-01", "u"), /PERCENT_INVALID/);
assert.equal(parseCommercialDiscount({ enabled: true, maxGapPercent: "4,5", targetSavingPercent: 2 }, "2026-11-01", "u").maxGapPercent, 4.5);

// Fast vs the Elios bill (169,95 € bill, 170,59 € quote, IVA 10%): the discount is a line with its own IVA.
const receipt = { status: "COMPLETE", currentTotal: 169.95, offerTotal: 170.59, savings: -0.64, savingsPercent: -0.4, taxesIncluded: true, vatRate: 0.1, vatRateEstimated: false, validUntil: null,
  rows: [{ key: "ENERGY", label: "Spesa per la vendita", current: 117.76, offer: 118.78, details: [] }, { key: "TAXES", label: "Imposte", current: 24.42, offer: 24.48, details: [{ key: "VAT", label: "IVA", current: 15.84, offer: 15.9, difference: 0.06 }] }],
  quotas: [] };
const discounted = withCommercialDiscount(receipt, policy);
const line = discounted.rows[0].details.find((item) => item.key === "COMPANY_DISCOUNT");
assert.match(line.label, /Sconto commerciale aziendale/);
assert.equal(discounted.offerTotal, Math.round(169.95 * 0.98 * 100) / 100);
assert.equal(discounted.savingsPercent, 2);
const gross = Math.round((170.59 - 169.95 * 0.98) * 100) / 100;
assert.equal(Math.round((-line.offer + (15.9 - discounted.rows[1].details[0].offer)) * 100) / 100, gross, "net discount + its IVA = the whole discount");
assert.equal(withCommercialDiscount(receipt, null), receipt);

// The permission cascades like the CTE authorization: a manager without it suspends it for their branch.
const node = (userId, level, parentUserId, canManageDiscount) => ({ tenantId: "t", recordId: userId, version: 1, createdAt: "", updatedAt: "", payload: { userId, level, parentUserId, displayName: null, limits: { vectors: null, customerCategories: null, excludedCteArchiveIds: [] }, ...(canManageDiscount ? { canManageDiscount: true } : {}), updatedBy: "admin" } });
const index = buildOrgChainIndex([node("admin", "AZIENDA", null), node("dir", "DIRETTORE", "admin", true), node("agent", "AGENTE", "dir", true), node("dir2", "DIRETTORE", "admin"), node("agent2", "AGENTE", "dir2", true)]);
assert.equal(nodeCanManageDiscount(index, "admin"), true);
assert.equal(nodeCanManageDiscount(index, "agent"), true);
assert.equal(nodeCanManageDiscount(index, "dir2"), false);
assert.equal(nodeCanManageDiscount(index, "agent2"), false, "suspended: their manager does not hold it");
console.log("commercial discount ok");
