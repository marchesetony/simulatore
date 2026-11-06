import assert from "node:assert/strict";
import { findGmeMonthlyBandsPdf, parseGmeMonthlyBandsText } from "../app/lib/market/gme-monthly-bands.ts";

// Tony (6/11): "il pun deve essere a fasce o monorario e va prelevato il dato mensile non il giornaliero". The PUN comes from
// GME's monthly "Prezzo medio per fasce". Layout as on GME's page and PDF; values of GME's September 2026 publication.
const html = `<ul><li><a href="/Portals/0/Documents/it-IT/20261103PrezzomedioperfasceOttobre2026.pdf"><img/></a>
<a href="/Portals/0/Documents/it-IT/20261103PrezzomedioperfasceOttobre2026.pdf">Prezzo medio per fasce - Ottobre 2026</a></li>
<li><a href="/Portals/0/Documents/it-IT/20260930PrezzomedioperfasceSettembre2026.pdf">Prezzo medio per fasce - Settembre 2026</a></li></ul>`;
assert.equal(findGmeMonthlyBandsPdf(html, "2026-09"), "https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT/20260930PrezzomedioperfasceSettembre2026.pdf");
assert.throws(() => findGmeMonthlyBandsPdf(html, "2026-08"), /GME_MONTHLY_BANDS_PDF_NOT_FOUND:2026-08/);

const text = "Prezzo medio di acquisto per fasce orarie Settembre 2026 €/MWh F1 (242 ore) 206,35 F2 (174 ore) 227,58 F3 (304 ore) 197,02 F1: ore di punta (peak) F2: ore intermedie (mid-level) F3: ore fuori punta (off-peak) *come definite dalla delibera dell'ARERA n°181 del 2006";
const values = parseGmeMonthlyBandsText(text, "2026-09");
assert.deepEqual([values.f1, values.f2, values.f3], [206.35, 227.58, 197.02]);
// Monorario = hours-weighted mean of the bands: 207,54, as GME's monthly average.
assert.equal(Math.round(values.monthly * 100) / 100, 207.54);
assert.throws(() => parseGmeMonthlyBandsText(text, "2026-10"), /MONTH_MISMATCH/);
// The hours must add up to the month (October 2026: 745 with the clock change).
assert.throws(() => parseGmeMonthlyBandsText(text.replace("(242 ore)", "(24 ore)"), "2026-09"), /HOURS_INVALID/);
assert.equal(parseGmeMonthlyBandsText("Ottobre 2026 €/MWh (242 ore) 233,39 (190 ore) 252,14 (313 ore) 215,88", "2026-10").hours.reduce((a, b) => a + b), 745);
console.log("gme monthly bands: ok");
assert.equal(parseGmeMonthlyBandsText("Settembre 2026 €/MWh 206,35 (242 ore) 227,58 (174 ore) 197,02 (304 ore)", "2026-09").f2, 227.58);
