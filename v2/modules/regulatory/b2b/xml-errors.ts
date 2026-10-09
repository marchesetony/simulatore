export type XmlParserErrorCode =
  | "XML_INPUT_INVALID" | "XML_EMPTY" | "XML_TOO_LARGE" | "XML_LIMIT_EXCEEDED"
  | "XML_ENCODING_INVALID" | "XML_DOCTYPE_FORBIDDEN" | "XML_DTD_FORBIDDEN"
  | "XML_ENTITY_FORBIDDEN" | "XML_NAMESPACE_INVALID" | "XML_PARSE_ERROR"
  | "XML_ABORTED";

export class XmlParserError extends Error {
  readonly code: XmlParserErrorCode;
  constructor(code: XmlParserErrorCode, message: string = code) {
    super(message);
    this.name = "XmlParserError";
    this.code = code;
  }
}
