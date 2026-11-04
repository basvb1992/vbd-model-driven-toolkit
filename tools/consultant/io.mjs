import { Buffer } from "node:buffer";
import { lstat, open } from "node:fs/promises";
import { dirname, extname, parse as parsePath, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { VbdError } from "../../dist/index.mjs";

export const maximumBytes = 1_048_576;

function localPath(input) {
  if (typeof input !== "string" || !input || input.length > 4096 ||
      input !== input.trim() || /[<>|?*]/.test(input) ||
      Array.from(input).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      /^[\\/]{2}/.test(input)) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "consultant.path" });
  }
  const withoutDrive = input.replace(/^[A-Za-z]:[\\/]/, "");
  if (withoutDrive.includes(":") || withoutDrive.split(/[\\/]/).some((part) =>
    part === ".." || (part !== "." && /[. ]$/.test(part)) ||
    /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part))) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "consultant.path" });
  }
  return resolve(input);
}

async function rejectLinkedParents(path) {
  let parent = dirname(path);
  while (parent !== parsePath(parent).root) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new VbdError("INVALID_ARGUMENT", { operation: "consultant.path" });
    }
    parent = dirname(parent);
  }
}

export async function readJson(input) {
  const path = localPath(input);
  let file;
  let text;
  try {
    await rejectLinkedParents(path);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new VbdError("INPUT_UNREADABLE", { operation: "consultant.read" });
    }
    if (metadata.size > maximumBytes) {
      throw new VbdError("INPUT_TOO_LARGE", { operation: "consultant.read" });
    }
    file = await open(path, "r");
    if (!(await file.stat()).isFile()) {
      throw new VbdError("INPUT_UNREADABLE", { operation: "consultant.read" });
    }
    // Bounded even if the file grows after stat; never read an unbounded payload.
    const bytes = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximumBytes) {
      throw new VbdError("INPUT_TOO_LARGE", { operation: "consultant.read" });
    }
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } catch (error) {
    if (error instanceof VbdError) throw error;
    throw new VbdError("INPUT_UNREADABLE", { operation: "consultant.read" });
  } finally {
    if (file) await file.close();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new VbdError("INVALID_JSON", { operation: "consultant.read" });
  }
}

export async function writeReport(output, text, format) {
  const path = localPath(output);
  if (!["json", "markdown"].includes(format) ||
      extname(path).toLowerCase() !== (format === "json" ? ".json" : ".md")) {
    throw new VbdError("INVALID_ARGUMENT", { operation: "consultant.path" });
  }
  let file;
  try {
    await rejectLinkedParents(path);
    // Exclusive create also rejects input paths, hard links and dangling symlinks.
    file = await open(path, "wx", 0o600);
    await file.writeFile(text, "utf8");
  } catch (error) {
    const exists = typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
    if (error instanceof VbdError) throw error;
    throw new VbdError(exists ? "OUTPUT_EXISTS" : "OUTPUT_UNWRITABLE", { operation: "consultant.write" });
  } finally {
    if (file) await file.close();
  }
}
