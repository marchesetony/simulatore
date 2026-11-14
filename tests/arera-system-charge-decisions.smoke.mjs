import assert from "node:assert/strict";
import { discoverAreraSystemChargeDecisions } from "../app/lib/foundation/arera-electricity-regulatory.ts";

// Tony (28/10): the ARERA refresh read the archive of past tables attached to the oneri page (a 2025 TabAB) and stopped on
// ARERA_ASOS_BTA6_CLASS_ROWS_MISSING. The page lists, quarter by quarter, the decision in force: that decision is the source.
const page = `<h3>Valori di ASOS, ARIM, UC3 e UC6</h3><ul>
<li>dal 01.10.26: <a href="/atti-e-provvedimenti/dettaglio/26/343-26">delibera 343/2026/R/com</a></li>
<li>dal 01.07.26: delibera <a href="https://www.arera.it/atti-e-provvedimenti/dettaglio/26/227-26">227/2026/R/com</a></li>
<li>dal 01.04.26: <a href="/atti-e-provvedimenti/dettaglio/26/98-26">delibera 98/2026/R/com</a></li>
<li>dal 01.01.26: <a href="/atti-e-provvedimenti/dettaglio/25/588-25">delibera 588/2025/R/com</a></li></ul>
<h3>Elementi della componente ASOS</h3><p>dal 01 luglio 2026: tabella A della relazione tecnica della <a href="/atti-e-provvedimenti/dettaglio/26/227-26">delibera 227/2026/R/com</a></p>
<p>Archivio: <a href="/fileadmin/allegati/docs/25/131-25tabAB_rt.xlsx">2025</a></p>`;
const decisions = discoverAreraSystemChargeDecisions(page, "2026-10-28T03:15:00.000Z", "https://www.arera.it/area-operatori/prezzi-e-tariffe/oneri-generali-di-sistema-e-ulteriori-componenti");
assert.deepEqual(decisions.map((item) => [item.identifier, item.effectiveFrom]), [["343/2026/R/com", "2026-10-01"], ["227/2026/R/com", "2026-07-01"], ["98/2026/R/com", "2026-04-01"], ["588/2025/R/com", "2026-01-01"]]);
assert.equal(decisions[0].url, "https://www.arera.it/atti-e-provvedimenti/dettaglio/26/343-26");
// A decision not yet in force is not used.
assert.equal(discoverAreraSystemChargeDecisions(page, "2026-09-15T00:00:00.000Z")[0].identifier, "227/2026/R/com");
console.log("ARERA_DECISION_IN_FORCE_DISCOVERED=PASS");
console.log("ARERA_PAST_TABLES_NOT_USED=PASS");
