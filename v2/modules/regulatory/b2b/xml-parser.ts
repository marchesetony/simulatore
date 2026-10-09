import { TextDecoder } from "node:util";
import { SaxesParser } from "saxes";
import { XmlParserError } from "./xml-errors";
import { XML_LIMITS_MAX, XML_PARSER_VERSION, type XmlLimits } from "./xml-limits";

export interface XmlPartInput {
  readonly bytes: Buffer;
  readonly partName: string;
  readonly limits: XmlLimits;
  readonly expectedNamespace?: string;
}

export interface XmlPartResult {
  readonly status: "VALID";
  readonly partName: string;
  readonly byteLength: number;
  readonly rootNamespace: string;
  readonly rootLocalName: string;
  readonly elementCount: number;
  readonly maxDepthObserved: number;
  readonly parserVersion: string;
  readonly limits: XmlLimits;
}

function fail(code: ConstructorParameters<typeof XmlParserError>[0], message: string): never { throw new XmlParserError(code, message); }
function validPartName(name: string): boolean {
  const parts = name.split("/");
  return name.length > 0 && name.length <= 256 && parts.length <= 16 && !name.startsWith("/") && !name.includes("\\") && !/^[A-Za-z]:/.test(name) && !parts.some((part) => part === "" || part === "." || part === "..");
}
function validateLimits(limits: XmlLimits): void {
  if (limits === null || typeof limits !== "object") fail("XML_INPUT_INVALID", "XML limits are required");
  const allowed = Object.keys(XML_LIMITS_MAX);
  const supplied = Object.keys(limits);
  if (supplied.length !== allowed.length || supplied.some((key) => !allowed.includes(key))) fail("XML_INPUT_INVALID", "unexpected XML limit parameter");
  for (const key of allowed as (keyof XmlLimits)[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > XML_LIMITS_MAX[key]) fail("XML_INPUT_INVALID", `invalid XML limit: ${key}`);
  }
}
function decodeUtf8(bytes: Buffer): string {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0x00 && bytes[1] === 0x00)) fail("XML_ENCODING_INVALID", "only UTF-8 XML is supported");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); } catch (error) { fail("XML_ENCODING_INVALID", error instanceof Error ? error.message : "invalid UTF-8"); }
}
function declaredEncoding(text: string): string | undefined {
  const header = text.replace(/^\uFEFF/, "").slice(0, 512);
  const match = /^<\?xml\s[^?]*?encoding\s*=\s*["']([^"']+)["'][^?]*\?>/u.exec(header);
  return match?.[1].toLowerCase();
}
function parserError(error: unknown): XmlParserError {
  const message = error instanceof Error ? error.message : "XML parser error";
  if (/entity/i.test(message)) return new XmlParserError("XML_ENTITY_FORBIDDEN", message);
  if (/namespace|prefix/i.test(message)) return new XmlParserError("XML_NAMESPACE_INVALID", message);
  return new XmlParserError("XML_PARSE_ERROR", message);
}

export function parseXmlPart(input: XmlPartInput): XmlPartResult {
  if (!Buffer.isBuffer(input?.bytes) || typeof input.partName !== "string" || !validPartName(input.partName)) fail("XML_INPUT_INVALID", "invalid XML part input");
  validateLimits(input.limits);
  if (input.bytes.length === 0) fail("XML_EMPTY", "XML part is empty");
  if (input.bytes.length > input.limits.maxBytes) fail("XML_TOO_LARGE", "XML part exceeds byte limit");
  const text = decodeUtf8(input.bytes);
  const encoding = declaredEncoding(text);
  if (encoding !== undefined && encoding !== "utf-8" && encoding !== "utf8") fail("XML_ENCODING_INVALID", "XML encoding is not UTF-8");
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0; let maxDepth = 0; let elements = 0; let namespaceDeclarations = 0; let ended = false; let rootNamespace: string | undefined; let rootLocalName: string | undefined; const textLengths: number[] = [];
  const abort = (error: unknown): never => { throw error instanceof XmlParserError ? error : parserError(error); };
  parser.on("error", (error) => abort(error));
  parser.on("doctype", () => abort(new XmlParserError("XML_DOCTYPE_FORBIDDEN", "DOCTYPE is forbidden")));
  parser.on("opentag", (tag) => {
    depth++; elements++; maxDepth = Math.max(maxDepth, depth);
    if (depth > input.limits.maxDepth || elements > input.limits.maxElements) abort(new XmlParserError("XML_LIMIT_EXCEEDED", "XML structure limit exceeded"));
    const attributes = Object.values(tag.attributes);
    if (attributes.length > input.limits.maxAttributesPerElement) abort(new XmlParserError("XML_LIMIT_EXCEEDED", "attribute limit exceeded"));
    let localText = 0;
    for (const attribute of attributes) {
      const value = typeof attribute === "string" ? attribute : attribute.value;
      if (value.length > input.limits.maxAttributeLength) abort(new XmlParserError("XML_LIMIT_EXCEEDED", "attribute length limit exceeded"));
      const name = typeof attribute === "string" ? "" : attribute.name;
      if (name === "xmlns" || name.startsWith("xmlns:")) namespaceDeclarations++;
    }
    if (namespaceDeclarations > input.limits.maxNamespaceDeclarations) abort(new XmlParserError("XML_LIMIT_EXCEEDED", "namespace declaration limit exceeded"));
    textLengths.push(localText);
    if (depth === 1) { rootNamespace = tag.uri; rootLocalName = tag.local; if (input.expectedNamespace !== undefined && rootNamespace !== input.expectedNamespace) abort(new XmlParserError("XML_NAMESPACE_INVALID", "unexpected root namespace")); }
  });
  const countText = (value: string) => { const index = textLengths.length - 1; if (index < 0) abort(new XmlParserError("XML_PARSE_ERROR", "text outside root")); textLengths[index] += value.length; if (textLengths[index] > input.limits.maxTextLength) abort(new XmlParserError("XML_LIMIT_EXCEEDED", "text length limit exceeded")); };
  parser.on("text", countText);
  parser.on("cdata", countText);
  parser.on("closetag", () => { depth--; textLengths.pop(); });
  parser.on("end", () => { ended = true; });
  try { for (let offset = 0; offset < text.length; offset += input.limits.maxChunkBytes) parser.write(text.slice(offset, offset + input.limits.maxChunkBytes)); parser.close(); } catch (error) { throw error instanceof XmlParserError ? error : parserError(error); }
  if (!ended || depth !== 0 || rootNamespace === undefined || rootLocalName === undefined) fail("XML_PARSE_ERROR", "XML did not complete successfully");
  return { status: "VALID", partName: input.partName, byteLength: input.bytes.length, rootNamespace, rootLocalName, elementCount: elements, maxDepthObserved: maxDepth, parserVersion: XML_PARSER_VERSION, limits: input.limits };
}
