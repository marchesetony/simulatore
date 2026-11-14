import assert from "node:assert/strict";
import { buildQuoteReceipt } from "../app/lib/quote/receipt.ts";

// Tony (5/11): "gli oneri no possono essere più alti quelli di bpowe rispetto alla fattura reale". The bill prints
// "Quota fissa - di cui spesa per la rete e gli oneri" 3,75 €; the detail read kept the oneri of the quota fissa (1,08 + 0,25)
// and lost the rete (2,42 €), so the bill column showed 1,33 € and the offer looked dearer. The bill column follows the
// printed quadro sintetico (Tony, 1/11, "attenersi all'originale"): 3,75 €, of which oneri 1,33 and rete 2,42.
const line = (classification, group, amount, description, unit, extra = {}) => ({ lineId: description, classification, group, amount, description, rawDescription: description, unit, unitPrice: null, rawUnitPrice: "", rawValue: "", aggregate: false, includedInReconciliation: true, ...extra });
const analysis = {
  components: [
    line("REGULATED_NETWORK", "REGULATED_NETWORK", "3,75 €", "QUOTA FISSA - di cui spesa per la rete e gli oneri 3,750000", "", { includedInReconciliation: false, accountingRole: "DETAIL_INCLUDED_IN_SUBTOTAL" }),
    line("SELLER_FIXED_FEE", "COMMERCIALIZATION", "16,00", "Commercializzazione e vendita - parte fissa", "€/pdp/mese"),
    line("ARERA_SYSTEM_CHARGES", "SYSTEM_CHARGES", "1,08", "Componente ASOS - Quota fissa", "€/pdp/mese"),
    line("ARERA_SYSTEM_CHARGES", "SYSTEM_CHARGES", "0,25", "Componente ARIM - Quota fissa", "€/pdp/mese"),
  ],
  totals: { sellerEnergyTotal: 0, sellerCommercializationTotal: 16, sellerOtherTotal: 0, regulatedNetworkTotal: 2.42, systemChargesTotal: 1.33, taxTotal: null },
};
const receipt = buildQuoteReceipt({ vector: "EE", offerSupplyCost: 15, analysis, domestic: false, validUntil: null, offerComponents: [] });
const fixed = receipt.quotas.find((quota) => quota.key === "FIXED");
assert.equal(fixed.current, 19.75, "16,00 vendita + 3,75 rete e oneri, as printed");
assert.equal(fixed.currentSeller, 16);
assert.equal(fixed.details.find((item) => item.key === "NETWORK").current, 2.42, "rete = 3,75 printed - 1,33 oneri read");
assert.equal(fixed.details.find((item) => item.key === "SYSTEM").current, 1.33);
console.log("receipt printed quota network ok");
