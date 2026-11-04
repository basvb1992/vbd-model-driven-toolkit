import { XMLParser, XMLValidator } from "fast-xml-parser";
import { VbdError } from "./errors.js";
import { isRecord, parseInput } from "./validation.js";
import { z } from "zod";
import { assertXmlCharacters } from "./utils.js";

export function checkedXml(input: string, rootName: "filter" | "fetch"): {
  xml: string;
  root: Record<string, unknown>;
} {
  const xml = parseInput(z.string().min(1), input, "xml.validate");
  if (new TextEncoder().encode(xml).byteLength > 262144) {
    throw new VbdError("LIMIT_EXCEEDED", { operation: "xml.validate" });
  }
  assertXmlCharacters(xml);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "xml.validate" });
  }
  let document: unknown;
  try {
    document = new XMLParser({
      ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false,
      parseAttributeValue: false, trimValues: false, processEntities: true,
      ignoreDeclaration: true, ignorePiTags: true
    }).parse(xml);
  } catch {
    throw new VbdError("INVALID_ARGUMENT", { operation: "xml.validate" });
  }
  if (!isRecord(document) || Object.keys(document).length !== 1 || !(rootName in document)) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "xml.validate" });
  }
  const root = document[rootName];
  if (root === "" || (typeof root === "string" && root.trim() === "")) {
    return { xml, root: {} };
  }
  if (!isRecord(root) || Array.isArray(root)) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "xml.validate" });
  }
  return { xml, root };
}
