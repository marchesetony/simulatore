import { fileURLToPath } from "node:url";

/**
 * Text of an official PDF as downloaded by the service (Tony 24/11/2026, regola definitiva acquisizione GME): the GME newsletters
 * are real-world PDFs (embedded subset fonts, compressed object streams, possibly encrypted with an empty user password) that the
 * simulator's own minimal reader cannot decode. Mozilla pdf.js (pdfjs-dist, Apache-2.0, pinned) reads them as a PDF viewer does.
 * Text only: no rendering, no fonts loaded, no network. The bytes are copied because pdf.js takes ownership
 * of the buffer it reads, and the caller still needs them for the SHA-256 and for conservation.
 */
export const PDFJS_VERSION = "6.5.438";
export const PDF_TEXT_MAX_PAGES = 80;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let loaded: Promise<PdfJs> | null = null;
const pdfjs = () => (loaded ??= import("pdfjs-dist/legacy/build/pdf.mjs"));
const cMapDirectory = () => fileURLToPath(new URL("./cmaps/", import.meta.resolve("pdfjs-dist/package.json")));

export async function officialPdfText(bytes: Uint8Array, maxPages = PDF_TEXT_MAX_PAGES): Promise<string> {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: bytes.slice(), cMapUrl: cMapDirectory(), cMapPacked: true, useSystemFonts: false, disableFontFace: true,
    enableXfa: false, stopAtErrors: false, verbosity: 0,
  });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    for (let index = 1; index <= Math.min(document.numPages, maxPages); index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")).join(""));
      page.cleanup();
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}
