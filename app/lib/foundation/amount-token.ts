// Tony (1/11, screenshot "lette 8.290.000.923.000.068,00 € su 333,96 €": "incomprensibile quello che hai scritto, errore").
// A bill amount read as text with several numbers in it ("8,29 € 0,000923 0,068") was turned into one number by gluing all
// the digits together. An amount is one number: when the text holds several, the money amount (two decimals, the last one
// as in "quantità × prezzo = importo") is taken; when none of them is a money amount, nothing is invented.

/** The single numeric token an amount text stands for, or null when it is ambiguous. */
export function amountToken(value: string): string | null {
  const tokens = value.match(/(?<![A-Za-z\d])[+-]?\d[\d.,]*%?/g)?.map((token) => token.replace(/[.,]+$/, "")) ?? [];
  if (tokens.length <= 1) return tokens[0] ?? null;
  const money = tokens.filter((token) => /^[+-]?\d{1,3}(?:\.\d{3})*,\d{2}$|^[+-]?\d+,\d{2}$|^[+-]?\d+\.\d{2}$/.test(token));
  return money.at(-1) ?? null;
}
