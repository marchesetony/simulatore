import assert from "node:assert/strict";
import { test } from "node:test";
import { XmlParserError } from "../modules/regulatory/b2b/xml-errors.ts";
import { parseXmlPart } from "../modules/regulatory/b2b/xml-parser.ts";
import { XML_LIMITS_MAX } from "../modules/regulatory/b2b/xml-limits.ts";

const limits = { ...XML_LIMITS_MAX };
const parse = (xml, options = {}) => parseXmlPart({ bytes: Buffer.isBuffer(xml) ? xml : Buffer.from(xml), partName: "xl/workbook.xml", limits, ...options });
const code = (fn) => { try { fn(); assert.fail("expected failure"); } catch (error) { assert.ok(error instanceof XmlParserError); return error.code; } };
const lower = (values) => ({ ...limits, ...values });

test("valid XML and OOXML namespace return bounded evidence", () => {
  const result = parse("<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheet/></workbook>", { expectedNamespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main" });
  assert.equal(result.status, "VALID"); assert.equal(result.rootLocalName, "workbook"); assert.equal(result.elementCount, 2);
});
test("rejects unexpected and unbound namespaces", () => {
  assert.equal(code(() => parse("<root xmlns=\"urn:other\"/>", { expectedNamespace: "urn:expected" })), "XML_NAMESPACE_INVALID");
  assert.equal(code(() => parse("<x:root/>", { expectedNamespace: "urn:expected" })), "XML_NAMESPACE_INVALID");
});
test("rejects malformed XML and duplicate attributes", () => {
  assert.equal(code(() => parse("<root>")), "XML_PARSE_ERROR");
  assert.equal(code(() => parse("<root a=\"1\" a=\"2\"/>")), "XML_PARSE_ERROR");
});
test("rejects DOCTYPE, DTD, entities and expansion attempts", () => {
  for (const xml of ["<!DOCTYPE root><root/>", "<!DOCTYPE root [<!ELEMENT root ANY>]><root/>", "<!DOCTYPE root [<!ENTITY x 'x'>]><root>&x;</root>", "<!DOCTYPE root [<!ENTITY x SYSTEM 'file:///tmp/x'>]><root>&x;</root>"]) assert.ok(["XML_DOCTYPE_FORBIDDEN", "XML_DTD_FORBIDDEN"].includes(code(() => parse(xml))));
});
test("does not reject DOCTYPE text inside comments or CDATA", () => {
  assert.equal(parse("<root><!-- <!DOCTYPE text> --></root>").status, "VALID");
  assert.equal(parse("<root><![CDATA[<!DOCTYPE text> <!ENTITY x 'y'>]]></root>").status, "VALID");
});
test("allows only predefined XML entities", () => {
  const result = parse("<root a=\"&amp;&lt;&gt;&apos;&quot;\">&amp;&lt;&gt;&apos;&quot;</root>"); assert.equal(result.status, "VALID");
  assert.equal(code(() => parse("<root>&custom;</root>")), "XML_ENTITY_FORBIDDEN");
});
test("validates UTF-8 bytes and BOM policy", () => {
  assert.equal(parse(Buffer.from("<root>è</root>", "utf8")).status, "VALID");
  assert.equal(parse(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<root/>")])).status, "VALID");
  assert.equal(code(() => parse(Buffer.from([0x3c, 0x72, 0x6f, 0x6f, 0x74, 0x3e, 0xc3, 0x28, 0x3c, 0x2f, 0x72, 0x6f, 0x6f, 0x74, 0x3e]))), "XML_ENCODING_INVALID");
  for (const malformed of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]]) assert.equal(code(() => parse(Buffer.concat([Buffer.from("<root>"), Buffer.from(malformed), Buffer.from("</root>")]))), "XML_ENCODING_INVALID");
  assert.equal(code(() => parse("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><root/>") ), "XML_ENCODING_INVALID");
  assert.equal(code(() => parse(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><root/>")]))), "XML_ENCODING_INVALID");
});
test("rejects empty input and invalid runtime parameters", () => {
  assert.equal(code(() => parse(Buffer.alloc(0))), "XML_EMPTY");
  assert.equal(code(() => parse("<root/>", { limits: lower({ maxDepth: 0 }) })), "XML_INPUT_INVALID");
  for (const maxBytes of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, XML_LIMITS_MAX.maxBytes + 1]) assert.equal(code(() => parse("<root/>", { limits: lower({ maxBytes }) })), "XML_INPUT_INVALID");
  assert.equal(code(() => parse("<root/>", { bytes: "<root/>" })), "XML_INPUT_INVALID");
});
test("enforces depth, element, attribute, text and namespace limits", () => {
  assert.equal(code(() => parse("<a><b><c/></b></a>", { limits: lower({ maxDepth: 2 }) })), "XML_LIMIT_EXCEEDED");
  assert.equal(code(() => parse("<a><b/><c/></a>", { limits: lower({ maxElements: 2 }) })), "XML_LIMIT_EXCEEDED");
  assert.equal(code(() => parse("<a x=\"1\" y=\"2\"/>", { limits: lower({ maxAttributesPerElement: 1 }) })), "XML_LIMIT_EXCEEDED");
  assert.equal(code(() => parse("<a>12345</a>", { limits: lower({ maxTextLength: 4 }) })), "XML_LIMIT_EXCEEDED");
  assert.equal(code(() => parse("<a><![CDATA[12345]]></a>", { limits: lower({ maxTextLength: 4 }) })), "XML_LIMIT_EXCEEDED");
  assert.equal(code(() => parse("<a x=\"12345\"/>", { limits: lower({ maxAttributeLength: 4 }) })), "XML_LIMIT_EXCEEDED");
  assert.equal(code(() => parse("<a xmlns:x=\"u\" xmlns:y=\"v\"/>", { limits: lower({ maxNamespaceDeclarations: 1 }) })), "XML_LIMIT_EXCEEDED");
});
test("applies byte and chunk limits without exposing partial state", () => {
  assert.equal(code(() => parse("<root/>", { limits: lower({ maxBytes: 3 }) })), "XML_TOO_LARGE");
  const fragmented = parse("<root><child>&amp;</child></root>", { limits: lower({ maxChunkBytes: 1 }) }); assert.equal(fragmented.status, "VALID");
  assert.equal(code(() => parse("<root/>", { limits: lower({ maxChunkBytes: 0 }) })), "XML_INPUT_INVALID");
  assert.equal(code(() => parse("<root/>", { limits: { ...limits, unexpected: 1 } })), "XML_INPUT_INVALID");
});
test("parser errors cannot produce a valid result or accept later input", () => {
  assert.equal(code(() => parse("<root><bad></root><later/>") ), "XML_PARSE_ERROR");
  assert.equal(code(() => parse("<root></root>", { partName: "../outside.xml" })), "XML_INPUT_INVALID");
});
