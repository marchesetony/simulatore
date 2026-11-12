// Tony (12/11/2026, "CONSUMO ANNUO STIMATO", regole 5 e 6): the review form holds only what the bill says. The annual
// consumption is optional: when the bill does not print it, the field stays empty and is neither confirmed nor corrected;
// the estimate is shown apart and never saved as a correction of the bill's data.
export const OPTIONAL_REVIEW_FIELDS: ReadonlySet<string> = new Set(["annualConsumption"]);

type ReadField = { readonly value: string | null; readonly confirmed: boolean } | undefined;

/** What the review sends: the fields still missing, the ones confirmed as read, the ones the user corrected. */
export function reviewSubmission(fields: readonly string[], values: Readonly<Record<string, string>>, read: Readonly<Record<string, ReadField>>): {
  readonly missing: readonly string[]; readonly confirm: readonly string[]; readonly correct: readonly { readonly field: string; readonly value: string }[];
} {
  const typed = (field: string) => (values[field] ?? "").trim();
  const original = (field: string) => read[field]?.value ?? "";
  return {
    missing: fields.filter((field) => !OPTIONAL_REVIEW_FIELDS.has(field) && !typed(field)),
    confirm: fields.filter((field) => typed(field) !== "" && typed(field) === original(field) && !read[field]?.confirmed),
    correct: fields.filter((field) => typed(field) !== original(field) && !(OPTIONAL_REVIEW_FIELDS.has(field) && typed(field) === "")).map((field) => ({ field, value: typed(field) })),
  };
}
