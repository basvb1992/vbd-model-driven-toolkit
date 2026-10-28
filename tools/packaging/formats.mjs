// Deliberately bounded readers, not general XML/ZIP extraction libraries.
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { Buffer } from "node:buffer";

export class PackagingError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}
export function requireThat(condition, code, message) {
  if (!condition) throw new PackagingError(code, message);
}
export const limits = Object.freeze({
  archive: 16 * 1024 * 1024, entry: 8 * 1024 * 1024,
  total: 20 * 1024 * 1024, entries: 16, xml: 256 * 1024,
  path: 180, notice: 256 * 1024
});
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function safeEntry(name) {
  requireThat(typeof name === "string" && name.length <= limits.path
    && /^[A-Za-z0-9_[\]./-]+$/.test(name)
    && !name.startsWith("/") && !name.includes("//")
    && name.split("/").every((part) => part && part !== "." && part !== ".."
      && !part.endsWith(".") && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)),
  "PATH", "Only bounded, relative portable file paths are accepted.");
  return name;
}
export function decode(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new PackagingError("ENCODING", "Expected valid UTF-8."); }
}
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(text) {
  requireThat(!/&(?!(?:amp|lt|gt|quot|apos);)/.test(text), "XML", "Unsupported XML entity.");
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, key) => entities[key]);
}
export function xml(bytes) {
  requireThat(bytes.length <= limits.xml, "XML_LIMIT", "Metadata exceeds XML limit.");
  let text = decode(bytes).replace(/^\uFEFF/, "");
  text = text.replace(/^<\?xml version="1\.0" encoding="utf-8"\s*\?>/i, "");
  requireThat(!text.includes("<!") && !text.includes("<?"), "XML", "DTD, comments and processing instructions are not accepted.");
  const root = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [root];
  const tokens = text.match(/<[^>]*>|[^<]+/g) ?? [];
  requireThat(tokens.join("") === text && tokens.length < 8000, "XML", "Invalid or oversized XML.");
  for (const token of tokens) {
    const parent = stack.at(-1);
    if (!token.startsWith("<")) { parent.text += unescapeXml(token); continue; }
    if (token.startsWith("</")) {
      requireThat(stack.length > 1 && token === `</${parent.name}>`, "XML", "Mismatched XML close tag.");
      stack.pop(); continue;
    }
    const match = /^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(token);
    requireThat(match && stack.length < 24, "XML", "Malformed or deeply nested XML.");
    const attrs = Object.create(null);
    let tail = match[2];
    while (tail.trim()) {
      const attr = /^\s+([A-Za-z_][\w:.-]*)="([^"<]*)"/.exec(tail);
      requireThat(attr && !Object.hasOwn(attrs, attr[1]), "XML", "Malformed or duplicate XML attribute.");
      attrs[attr[1]] = unescapeXml(attr[2]);
      tail = tail.slice(attr[0].length);
    }
    const node = { name: match[1], attrs, children: [], text: "" };
    parent.children.push(node);
    if (!match[3]) stack.push(node);
  }
  requireThat(stack.length === 1 && root.children.length === 1 && !root.text.trim(),
    "XML", "Expected one complete XML document.");
  return root.children[0];
}
export function childrenOnly(node, names) {
  requireThat(!node.text.trim() && node.children.every((child) => names.includes(child.name)),
    "COMPONENT", "Unexpected XML content; standalone component boundary rejected.");
  const seen = new Set();
  for (const child of node.children) {
    requireThat(!seen.has(child.name), "XML", "Duplicate metadata element.");
    seen.add(child.name);
  }
}
export function child(node, name) {
  const found = node.children.filter((item) => item.name === name);
  requireThat(found.length === 1, "XML", `Expected exactly one ${name}.`);
  return found[0];
}
export function value(node, name) {
  const found = child(node, name);
  requireThat(found.children.length === 0, "XML", "Expected scalar metadata.");
  return found.text;
}
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// No entry is ever extracted. Central AND local paths/headers are checked before
// decompressing; ZIP64, encryption, symlinks, overlapping entries are rejected.
export function readZip(bytes, { format = "pac" } = {}) {
  requireThat(["pac", "dataverseExport"].includes(format), "ZIP", "Unsupported ZIP dialect.");
  requireThat(Buffer.isBuffer(bytes) && bytes.length >= 22 && bytes.length <= limits.archive,
    "ZIP_LIMIT", "ZIP must be 22 bytes through 16 MiB.");
  try {
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
    requireThat(end >= 0 && bytes.readUInt32LE(end) === 0x06054b50, "ZIP", "Missing ZIP directory.");
    const count = bytes.readUInt16LE(end + 10);
    const size = bytes.readUInt32LE(end + 12);
    const start = bytes.readUInt32LE(end + 16);
    requireThat(bytes.readUInt16LE(end + 4) === 0 && bytes.readUInt16LE(end + 6) === 0
      && bytes.readUInt16LE(end + 8) === count && count > 0 && count <= limits.entries
      && start + size === end && bytes.readUInt16LE(end + 20) === 0 && end + 22 === bytes.length,
    "ZIP", "Split/ZIP64/invalid directory or too many entries.");
    const files = new Map(), folded = new Set(), ranges = [];
    let cursor = start, total = 0;
    for (let index = 0; index < count; index++) {
      requireThat(cursor + 46 <= end && bytes.readUInt32LE(cursor) === 0x02014b50, "ZIP", "Invalid central header.");
      const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
      const crc = bytes.readUInt32LE(cursor + 16), compressed = bytes.readUInt32LE(cursor + 20);
      const length = bytes.readUInt32LE(cursor + 24), n = bytes.readUInt16LE(cursor + 28);
      const extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
      const offset = bytes.readUInt32LE(cursor + 42), mode = bytes.readUInt32LE(cursor + 38) >>> 16;
      requireThat(cursor + 46 + n + extra + comment <= end && extra === 0 && comment === 0
        && bytes.readUInt16LE(cursor + 34) === 0
        && (bytes.readUInt32LE(cursor + 38) & 0x410) === 0
        && (flags & ~0x80e) === 0 && [0, 8].includes(method) && (mode & 0xf000) !== 0xa000
        && ((mode & 0xf000) === 0 || (mode & 0xf000) === 0x8000)
        && length <= limits.entry && compressed <= limits.archive && total + length <= limits.total,
      "ZIP_LIMIT", "Unsupported flags/method/link or size bound exceeded.");
      const name = safeEntry(decode(bytes.subarray(cursor + 46, cursor + 46 + n)));
      requireThat(!folded.has(name.toLowerCase()), "ZIP", "Duplicate or case-colliding ZIP path.");
      folded.add(name.toLowerCase());
      requireThat(offset + 30 <= start && bytes.readUInt32LE(offset) === 0x04034b50
        && bytes.readUInt16LE(offset + 6) === flags && bytes.readUInt16LE(offset + 8) === method,
      "ZIP", "Local header mismatch.");
      const localN = bytes.readUInt16LE(offset + 26), localExtra = bytes.readUInt16LE(offset + 28);
      const dataStart = offset + 30 + localN + localExtra, dataEnd = dataStart + compressed;
      const padding = bytes.subarray(offset + 30 + localN, dataStart);
      const exportPadding = format === "dataverseExport" && localExtra === 28 &&
        padding.toString("hex") === "20a2180028a014000000000000000000000000000000000000000000";
      requireThat((localExtra === 0 || exportPadding) && dataEnd <= start &&
        decode(bytes.subarray(offset + 30, offset + 30 + localN)) === name,
        "ZIP", "Local path or entry boundary mismatch.");
      if (!(flags & 8)) requireThat(bytes.readUInt32LE(offset + 14) === crc
        && bytes.readUInt32LE(offset + 18) === compressed && bytes.readUInt32LE(offset + 22) === length,
      "ZIP", "Local size/checksum mismatch.");
      let rangeEnd = dataEnd;
      if (flags & 8) {
        const descriptor = dataEnd + (bytes.readUInt32LE(dataEnd) === 0x08074b50 ? 4 : 0);
        rangeEnd = descriptor + 12;
        requireThat(rangeEnd <= start && bytes.readUInt32LE(descriptor) === crc
          && bytes.readUInt32LE(descriptor + 4) === compressed && bytes.readUInt32LE(descriptor + 8) === length,
        "ZIP", "Invalid data descriptor.");
      }
      requireThat(ranges.every(([a, b]) => rangeEnd <= a || offset >= b), "ZIP", "Overlapping ZIP entries.");
      ranges.push([offset, rangeEnd]);
      const input = bytes.subarray(dataStart, dataEnd);
      const inflated = method === 0 ? undefined : inflateRawSync(input, { maxOutputLength: limits.entry, info: true });
      requireThat(!inflated || inflated.engine.bytesWritten === compressed, "ZIP", "Trailing compressed data is not accepted.");
      const output = inflated ? inflated.buffer : input;
      requireThat(output.length === length && crc32(output) === crc, "CHECKSUM", "Entry length/CRC mismatch.");
      files.set(name, output); total += length;
      cursor += 46 + n + extra + comment;
    }
    requireThat(cursor === end, "ZIP", "Unexpected ZIP directory bytes.");
    ranges.sort((a, b) => a[0] - b[0]);
    requireThat(ranges[0][0] === 0 && ranges.at(-1)[1] === start
      && ranges.every(([a], index) => index === 0 || a === ranges[index - 1][1]),
    "ZIP", "ZIP prefixes, gaps and unindexed data are not accepted.");
    return files;
  } catch (error) {
    if (error instanceof PackagingError) throw error;
    throw new PackagingError("ZIP", "Malformed or excessive compressed input.");
  }
}
