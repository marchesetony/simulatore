const monthNames = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"] as const;

function htmlText(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function allowedGmeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === "gme.mercatoelettrico.org";
  } catch {
    return false;
  }
}

export function gmeMonthName(referenceMonth: string): string {
  const month = Number(referenceMonth.slice(5, 7));
  return monthNames[month - 1] ?? "";
}

export function findPublicationLink(discoveryText: string, baseUrl: string, referenceMonth: string): string {
  const monthName = gmeMonthName(referenceMonth);
  const year = referenceMonth.slice(0, 4);
  if (!monthName || !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(referenceMonth)) throw new Error("GME_REFERENCE_MONTH_INVALID");
  const monthAndYear = new RegExp(`${monthName}[\\s._/-]*${year}`, "i");
  const links: string[] = [];
  const pattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of discoveryText.matchAll(pattern)) {
    const href = match[2].trim();
    const label = htmlText(match[3]);
    const combined = `${href} ${label}`;
    if (!monthAndYear.test(combined) || !/(pubblic|prezzo|fasce|pun|download|xls|pdf)/i.test(combined)) continue;
    const candidate = new URL(href, baseUrl).toString();
    if (!allowedGmeUrl(candidate)) throw new Error("GME_SOURCE_DOMAIN_BLOCKED");
    links.push(candidate);
  }
  const uniqueLinks = [...new Set(links)];
  if (uniqueLinks.length !== 1) throw new Error(uniqueLinks.length === 0 ? "GME_PUBLICATION_DISCOVERY_NOT_FOUND" : "GME_PUBLICATION_DISCOVERY_AMBIGUOUS");
  return uniqueLinks[0];
}

export function extractExplicitPublicationDate(text: string): string | null {
  const match = /(?:pubblicat[oa]|data\s+pubblicazione|publication\s+date)[^0-9]{0,40}(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/i.exec(text);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
}
