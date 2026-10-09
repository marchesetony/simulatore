export interface XmlLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxElements: number;
  readonly maxAttributesPerElement: number;
  readonly maxTextLength: number;
  readonly maxAttributeLength: number;
  readonly maxNamespaceDeclarations: number;
  readonly maxChunkBytes: number;
}

export const XML_LIMITS_MAX: Readonly<XmlLimits> = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 128,
  maxElements: 250_000,
  maxAttributesPerElement: 128,
  maxTextLength: 1024 * 1024,
  maxAttributeLength: 1024 * 1024,
  maxNamespaceDeclarations: 1024,
  maxChunkBytes: 64 * 1024,
});

export const XML_PARSER_VERSION = "B2B2.1-saxes-6.0.0";
