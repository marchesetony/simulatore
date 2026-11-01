import assert from "node:assert/strict";
import { anthropicToolControls } from "../app/lib/cte/anthropic.ts";

// Tony (1/11): "gli agenti devono essere in grado di leggere bollette diverse ma a estrarre i dati che servono, senza inventare
// nulla, applicando sempre e perentoriamente una temperatura di 0 gradi". Every bill and CTE reader shares these controls:
// models that accept a temperature get 0; the ones that reject any sampling value (400) get none.
for (const model of ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-opus-4-6", "claude-opus-4-5"]) {
  assert.equal(anthropicToolControls(model, "t").temperature, 0, model);
}
for (const model of ["claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]) {
  assert.equal("temperature" in anthropicToolControls(model, "t"), false, model);
}
console.log("reader temperature zero ok");
