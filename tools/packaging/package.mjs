// Local-only delivery tooling. Never calls auth, Dataverse, import or publish.
import { lstat, readdir, open, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, join, dirname, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  browserBuildOptions, collectBundleNotices, NOTICE_HEADER, packageRootForInput
} from "../../scripts/bundle-contract.mjs";
import {
  PackagingError, requireThat, limits, sha256, decode, xml, child, value,
  childrenOnly, readZip, safeEntry
} from "./formats.mjs";

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const identity = "VBDModelDrivenToolkit";
export const resources = Object.freeze([
  { name: "vbd_/toolkit/vbd.toolkit.js", file: "vbd_toolkit.js", type: "3" },
  { name: "vbd_/toolkit/THIRD-PARTY-NOTICES.html", file: "vbd_THIRD-PARTY-NOTICES.html", type: "1" }
]);
const sourceFiles = [
  "Other/Solution.xml", "Other/Customizations.xml", "Other/Relationships.xml",
  ...resources.map((item) => `WebResources/${item.file}.data.xml`)
].sort();
const solutionInventory = Object.freeze({ files: 16, nodes: 32, depth: 4 });
const runtimeInventory = Object.freeze({ files: 512, nodes: 512, depth: 8 });
const runtimePackages = new Set([
  "@nodable/entities", "anynum", "fast-xml-builder", "fast-xml-parser", "is-unsafe",
  "path-expression-matcher", "strnum", "xml-naming", "zod"
]);
function runtimeInputPath(file) {
  if (file.startsWith("src/")) { safeEntry(file); return; }
  const packageRoot = packageRootForInput(file);
  const name = packageRoot?.slice("node_modules/".length);
  requireThat(packageRoot === `node_modules/${name}` && runtimePackages.has(name)
    && file.startsWith(`${packageRoot}/`), "BUILD_DEPENDENCY",
  "Only reviewed Core runtime packages are allowed; no framework/Studio/delivery dependencies.");
  safeEntry(file.slice(packageRoot.length + 1));
}
// Caller-owned filesystem paths accept either separator. Do not resolve dot
// segments here: validation must still reject traversal after normalization.
function portableInput(path) {
  return typeof path === "string" ? path.replaceAll("\\", "/") : path;
}
const emptyCollections = [
  "Entities", "Roles", "Workflows", "FieldSecurityProfiles", "Templates",
  "EntityMaps", "EntityRelationships", "OrganizationSettings", "optionsets",
  "CustomControls", "SolutionPluginAssemblies", "EntityDataProviders"
];
export function version(input) {
  requireThat(typeof input === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(input)
    && input.split(".").every((part) => Number(part) <= 65535),
  "VERSION", "Use four canonical decimal components, each 0..65535.");
  return input;
}
// Stable public component identities across machines/versions, never tenant GUIDs.
// UUID-shaped SHA-256 name digest, with RFC variant/version bits; NOT UUIDv5.
export function componentId(name) {
  const hash = createHash("sha256").update(`VBDModelDrivenToolkit/WebResource/${name}`).digest();
  hash[6] = (hash[6] & 15) | 0x80;
  hash[8] = (hash[8] & 63) | 0x80;
  const h = hash.subarray(0, 16).toString("hex");
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`;
}
export function noSensitiveContent(bytes) {
  const text = decode(bytes);
  requireThat(!/https?:\/\/[\w-]+\.crm\d*\.(?:dynamics\.com|microsoftdynamics\.[a-z.]+)/i.test(text)
    && !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
    && !/\beyJ[\w-]{12,}\.[\w-]{12,}\.[\w-]{12,}\b/.test(text)
    && !/(?:AccountKey|SharedAccessSignature|client_secret|access_token)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9+/_.=-]{12,}/i.test(text),
  "SENSITIVE_INPUT", "Possible credential or tenant URL detected. Use a reviewed, environment-neutral build.");
}
export function noticesHtml(bytes) {
  requireThat(bytes.length > NOTICE_HEADER.length && bytes.length <= limits.notice
    && decode(bytes).startsWith(NOTICE_HEADER),
  "NOTICES", "Build must include the complete canonical bundled third-party notice.");
  return Buffer.from(`<!doctype html><meta charset="utf-8"><title>VBD Toolkit third-party notices</title><pre>${
    decode(bytes).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  }</pre>\n`);
}
async function reproduceBrowser(root) {
  let esbuild;
  try { esbuild = await import("esbuild"); }
  catch { throw new PackagingError("BUILD_DEPENDENCY", "Locked esbuild is unavailable; run npm ci in this worktree."); }
  try {
    // Same browser-only options as scripts/build.mjs. No files are emitted.
    const result = await esbuild.build({
      ...browserBuildOptions, absWorkingDir: root, write: false, logLevel: "silent"
    });
    requireThat(result.outputFiles.length === 1 && result.outputFiles[0].contents.length <= limits.entry,
      "BUILD_ASSET", "Expected one bounded browser bundle.");
    requireThat(result.warnings.length === 0 && Object.values(result.metafile.outputs).every((output) => output.imports.length === 0)
      && Object.keys(result.metafile.inputs).length <= 512,
    "BUILD_DEPENDENCY", "Browser bundle must have no warnings/external imports and at most 512 build inputs.");
    let total = 0;
    const observed = new Map();
    for (const [file, info] of Object.entries(result.metafile.inputs)) {
      runtimeInputPath(file);
      requireThat(info.bytes <= limits.entry && (total += info.bytes) <= limits.total,
        "BUILD_DEPENDENCY", "Bundled source exceeds its per-file/total bound.");
      observed.set(file, await boundedFile(root, file));
    }
    const notice = await collectBundleNotices(root, Object.keys(result.metafile.inputs), {
      read: async (file) => {
        if (file === "third-party/licenses/nodable-entities-3.1.0.txt") safeEntry(file);
        else runtimeInputPath(file);
        const bytes = await boundedFile(root, file, limits.notice);
        observed.set(file, bytes);
        return bytes;
      }
    });
    const lock = JSON.parse(decode(await boundedFile(root, "package-lock.json")));
    requireThat(notice.packages.every((pkg) =>
      lock.packages?.[pkg.root]?.version === pkg.version && typeof lock.packages[pkg.root].integrity === "string"),
    "BUILD_DEPENDENCY", "Installed runtime package versions must match the reviewed dependency lock.");
    return {
      browser: Buffer.from(result.outputFiles[0].contents),
      notices: Buffer.from(notice.text), files: observed, packages: notice.packages
    };
  } catch (error) {
    if (error instanceof PackagingError) throw error;
    throw new PackagingError("BUILD_REPRODUCE", "Cannot reproduce the browser/notices; run npm ci and npm run build, then inspect the shared contract and licenses.");
  }
}
async function regularPath(root, path) {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  requireThat(rel && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel), "PATH", "Input must stay inside the worktree.");
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (error.code === "ENOENT") throw new PackagingError("MISSING_INPUT", "Required input missing; run npm run build or restore solution source.");
      throw new PackagingError("INPUT_IO", "Cannot inspect required input permissions.");
    }
    requireThat(!stat.isSymbolicLink(), "PATH", "Symlinks/junctions are not accepted as inputs or output ancestors.");
  }
  return absolute;
}
async function boundedFile(root, path, maximum = limits.entry) {
  const absolute = await regularPath(root, path);
  const stat = await lstat(absolute);
  requireThat(stat.isFile() && stat.size > 0 && stat.size <= maximum, "INPUT_SIZE", "Required input is empty, nonregular or oversized.");
  const handle = await open(absolute, "r");
  try {
    const before = await handle.stat();
    requireThat(before.isFile() && before.size === stat.size && before.ino === stat.ino && before.dev === stat.dev,
      "INPUT_CHANGED", "Input was replaced while opening.");
    // At most stat.size+1 bytes, even if an input grows concurrently.
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    requireThat(length === stat.size && after.size === stat.size && before.mtimeMs === after.mtimeMs,
      "INPUT_CHANGED", "Input changed while reading.");
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
async function inventory(root, path, bounds = solutionInventory) {
  const absolute = await regularPath(root, path);
  const files = [];
  let nodes = 0;
  async function visit(dir, prefix = "") {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      requireThat(++nodes <= bounds.nodes, "INVENTORY_LIMIT", `Source tree exceeds the ${bounds.nodes}-node inventory bound.`);
      requireThat(!item.isSymbolicLink(), "PATH", "Source may not contain links.");
      const name = safeEntry(prefix + item.name);
      if (item.isDirectory()) {
        requireThat(name.split("/").length <= bounds.depth, "INVENTORY_LIMIT", `Source tree exceeds ${bounds.depth} directory levels.`);
        await visit(join(dir, item.name), `${name}/`);
      } else {
        requireThat(item.isFile(), "COMPONENT", "Only regular source files are accepted.");
        requireThat(files.length < bounds.files, "INVENTORY_LIMIT", `Source tree exceeds the ${bounds.files}-file inventory bound.`);
        files.push(name);
      }
    }
  }
  await visit(absolute);
  return files.sort();
}
function empty(node) {
  requireThat(!node.children.length && !node.text.trim() && !Object.keys(node.attrs).length,
    "DEPENDENCY", "Unexpected component, dependency or environment setting.");
}
function metadata(bytes, exported = false) {
  noSensitiveContent(bytes);
  const root = xml(bytes);
  function visit(node) {
    const attributes = {
      ImportExportXml: ["version", "SolutionPackageVersion", "languagecode", "generatedBy", "xmlns:xsi",
        ...(exported ? ["OrganizationVersion", "OrganizationSchemaType", "CRMServerServiceabilityVersion"] : [])],
      WebResource: ["xmlns:xsi"], RootComponent: ["type", "schemaName", "behavior"],
      LocalizedName: ["description", "languagecode"], Description: ["description", "languagecode"]
    };
    const allowed = Object.hasOwn(attributes, node.name) ? attributes[node.name] : [];
    requireThat(Object.keys(node.attrs).every((key) => allowed.includes(key) || key === "xsi:nil"), "COMPONENT", "Unexpected metadata attribute.");
    for (const [key, val] of Object.entries(node.attrs)) {
      if (key === "xmlns:xsi") requireThat(val === "http://www.w3.org/2001/XMLSchema-instance", "XML", "Unexpected schema namespace.");
      if (key === "version") version(val);
      if (key === "SolutionPackageVersion") requireThat(val === (exported ? "9.2" : "9.1"), "XML", "Unsupported solution package format version.");
      if (key === "OrganizationVersion" || key === "CRMServerServiceabilityVersion") {
        requireThat(/^\d{1,5}(?:\.\d{1,5}){3}$/.test(val) && val.split(".").every(part => Number(part) <= 65535),
          "XML", "Unsupported organization build metadata.");
      }
      if (key === "OrganizationSchemaType") requireThat(val === "Full", "XML", "Unsupported organization schema metadata.");
      if (key === "generatedBy") requireThat(val === "CrmLive", "XML", "Unsupported solution generator.");
      if (key === "languagecode") requireThat(val === "1033", "XML", "Unsupported metadata language.");
      if (key === "xsi:nil") requireThat(val === "true" && !node.children.length && !node.text.trim(), "XML", "Nil metadata must be empty.");
    }
    node.children.forEach(visit);
  }
  visit(root);
  return root;
}
function blankPublisherDetails(publisher) {
  for (const name of ["EMailAddress", "SupportingWebsiteUrl"]) {
    const nodes = publisher.children.filter((node) => node.name === name);
    if (nodes.length) requireThat(!nodes[0].children.length && !nodes[0].text.trim(),
      "SENSITIVE_INPUT", "Publisher contact/environment values must be absent.");
  }
  const addresses = publisher.children.find((node) => node.name === "Addresses");
  if (!addresses) return;
  requireThat(!addresses.text.trim() && addresses.children.length <= 2, "COMPONENT", "Unexpected publisher addresses.");
  const nilFields = ["City", "County", "Country", "Fax", "FreightTermsCode", "ImportSequenceNumber", "Latitude",
    "Line1", "Line2", "Line3", "Longitude", "Name", "PostalCode", "PostOfficeBox", "PrimaryContactName",
    "StateOrProvince", "Telephone1", "Telephone2", "Telephone3", "TimeZoneRuleVersionNumber", "UPSZone",
    "UTCOffset", "UTCConversionTimeZoneCode"];
  const numbers = new Set();
  for (const address of addresses.children) {
    requireThat(address.name === "Address", "COMPONENT", "Unexpected publisher address element.");
    childrenOnly(address, ["AddressNumber", "AddressTypeCode", "ShippingMethodCode", ...nilFields]);
    const number = value(address, "AddressNumber");
    requireThat(["1", "2"].includes(number) && !numbers.has(number), "COMPONENT", "Unexpected publisher address number.");
    numbers.add(number);
    for (const node of address.children) {
      if (["AddressNumber", "AddressTypeCode", "ShippingMethodCode"].includes(node.name)) {
        requireThat(!node.children.length && node.text === (node.name === "AddressNumber" ? number : "1"),
          "COMPONENT", "Unexpected publisher address defaults.");
      } else requireThat(!node.children.length && !node.text.trim(), "SENSITIVE_INPUT", "Publisher addresses must be blank.");
    }
  }
}
function localization(node, element, expected) {
  requireThat(!node.text.trim() && node.children.length === (expected ? 1 : 0), "IDENTITY", "Unexpected localized metadata.");
  if (expected) requireThat(node.children[0].name === element
    && node.children[0].attrs.description === expected && node.children[0].attrs.languagecode === "1033"
    && Object.keys(node.children[0].attrs).length === 2 && !node.children[0].children.length
    && !node.children[0].text.trim(), "IDENTITY", "Unexpected localized value.");
}
function manifest(bytes, expectedVersion, kind, exported = false) {
  const root = metadata(bytes, exported);
  requireThat(root.name === "ImportExportXml", "XML", "Expected supported ImportExportXml metadata.");
  childrenOnly(root, ["SolutionManifest"]);
  const m = child(root, "SolutionManifest");
  childrenOnly(m, ["UniqueName", "LocalizedNames", "Descriptions", "Version", "Managed", "Publisher", "RootComponents", "MissingDependencies"]);
  requireThat(value(m, "UniqueName") === identity && value(m, "Version") === expectedVersion
    && value(m, "Managed") === (kind === "managed" ? "1" : "0"), "IDENTITY", "Solution name, version or package kind mismatch.");
  localization(child(m, "LocalizedNames"), "LocalizedName", "VBD Model-Driven Toolkit");
  localization(child(m, "Descriptions"), "Description",
    "Standalone VBD browser core. No app, form, table, command, Studio or workflow framework bindings.");
  const p = child(m, "Publisher");
  childrenOnly(p, ["UniqueName", "LocalizedNames", "Descriptions", "CustomizationPrefix", "CustomizationOptionValuePrefix",
    "EMailAddress", "SupportingWebsiteUrl", "Addresses"]);
  requireThat(value(p, "UniqueName") === "VBDModelDrivenToolkit" && value(p, "CustomizationPrefix") === "vbd"
    && value(p, "CustomizationOptionValuePrefix") === "59926", "PREFIX", "Only the independent VBD publisher is accepted.");
  localization(child(p, "LocalizedNames"), "LocalizedName", "VBD Toolkit");
  empty(child(p, "Descriptions")); empty(child(m, "MissingDependencies"));
  blankPublisherDetails(p);
  const roots = child(m, "RootComponents");
  requireThat(!roots.text.trim() && roots.children.length === resources.length, "COMPONENT", "Expected exactly two root components.");
  const names = new Set();
  for (const item of roots.children) {
    requireThat(item.name === "RootComponent" && item.attrs.type === "61" && item.attrs.behavior === "0"
      && Object.keys(item.attrs).length === 3 && !item.text.trim() && !item.children.length,
    "COMPONENT", "Only webresource root components are accepted.");
    names.add(item.attrs.schemaName);
  }
  requireThat(names.size === resources.length && resources.every((item) => names.has(item.name)),
    "COMPONENT", "Toolkit root component names do not match.");
}
function exportResourcePath(item) {
  return `WebResources/${item.name.replace(/[/.]/g, "")}${componentId(item.name).replace(/[{}]/g, "").toUpperCase()}`;
}
function descriptor(node, item, expectedVersion, staged, exported = false) {
  requireThat(node.name === "WebResource", "COMPONENT", "Expected WebResource.");
  childrenOnly(node, ["WebResourceId", "Name", "DisplayName", "WebResourceType", "IsCustomizable", "IntroducedVersion",
    "IsEnabledForMobileClient", "IsAvailableForMobileOffline", "FileName",
    ...(exported ? ["CanBeDeleted", "IsHidden"] : [])]);
  if (exported) requireThat(value(node, "CanBeDeleted") === "1" && value(node, "IsHidden") === "0",
    "COMPONENT", "Unexpected exported webresource properties.");
  requireThat(value(node, "Name") === item.name && value(node, "WebResourceType") === item.type
    && value(node, "IntroducedVersion") === expectedVersion
    && value(node, "IsCustomizable") === "1" && value(node, "IsEnabledForMobileClient") === "0"
    && value(node, "IsAvailableForMobileOffline") === "0"
    && value(node, "DisplayName") === (item.type === "3" ? "VBD Toolkit" : "VBD Toolkit Third-Party Notices"),
  "COMPONENT", "Webresource name/type/version/flags do not match the toolkit contract.");
  const file = value(node, "FileName");
  if (exported) requireThat(file === `/${exportResourcePath(item)}`,
    "COMPONENT", "Unexpected exported payload identity/path.");
  requireThat(file.startsWith("/WebResources/"), "PATH", "Webresource payload must be in WebResources.");
  safeEntry(file.slice(1));
  if (staged) requireThat(value(node, "WebResourceId").toLowerCase() === componentId(item.name).toLowerCase(),
    "COMPONENT", "Webresource ID differs from the stable toolkit identity.");
  else requireThat(!node.children.some((c) => c.name === "WebResourceId")
    && node.attrs["xmlns:xsi"] === "http://www.w3.org/2001/XMLSchema-instance"
    && file === `/WebResources/${item.file}`, "COMPONENT", "Source identity is derived, not environment-specific.");
  return file.slice(1);
}
function customizations(bytes, expectedVersion, staged, exported = false) {
  const root = metadata(bytes, exported);
  requireThat(root.name === "ImportExportXml", "XML", "Expected customizations XML.");
  childrenOnly(root, [...emptyCollections, "Languages", "WebResources"]);
  for (const name of emptyCollections) {
    if (exported && name === "SolutionPluginAssemblies" && !root.children.some(node => node.name === name)) continue;
    empty(child(root, name));
  }
  const languages = child(root, "Languages");
  childrenOnly(languages, ["Language"]);
  requireThat(value(languages, "Language") === "1033", "COMPONENT", "Only the source base language is accepted.");
  const web = child(root, "WebResources");
  if (!staged) { empty(web); return []; }
  requireThat(!web.text.trim() && web.children.length === resources.length, "COMPONENT", "Expected exactly two webresources.");
  return resources.map((item) => {
    const matches = web.children.filter((node) => value(node, "Name") === item.name);
    requireThat(matches.length === 1, "COMPONENT", "Missing or duplicate toolkit webresource.");
    return descriptor(matches[0], item, expectedVersion, true, exported);
  });
}
export async function inputs(root = repository) {
  requireThat(JSON.stringify(await inventory(root, "solution")) === JSON.stringify(sourceFiles),
    "COMPONENT", "Solution source must contain only the five approved XML files.");
  const packageBytes = await boundedFile(root, "package.json", limits.xml);
  let pkg;
  try { pkg = JSON.parse(decode(packageBytes)); }
  catch { throw new PackagingError("VERSION", "package.json is invalid JSON."); }
  requireThat(typeof pkg.version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version),
    "VERSION", "Release packaging requires a stable package semantic version.");
  const expectedVersion = version(`${pkg.version}.0`);
  requireThat(pkg.dependencies && JSON.stringify(Object.keys(pkg.dependencies).sort()) ===
    JSON.stringify(["fast-xml-parser", "zod"]), "BUILD_DEPENDENCY",
  "Runtime dependency declarations differ from the reviewed expanded-core contract.");
  const runtimeVersion = decode(await boundedFile(root, "src/version.ts", limits.xml));
  requireThat(runtimeVersion.trim() === `export const version = "${pkg.version}";`,
    "VERSION", "Runtime source version must match package.json before release packaging.");
  const source = new Map();
  for (const file of sourceFiles) {
    const bytes = await boundedFile(root, `solution/${file}`, limits.xml);
    noSensitiveContent(bytes); source.set(file, bytes);
  }
  manifest(source.get("Other/Solution.xml"), expectedVersion, "unmanaged", false);
  customizations(source.get("Other/Customizations.xml"), expectedVersion, false);
  const rel = metadata(source.get("Other/Relationships.xml"));
  requireThat(rel.name === "EntityRelationships", "COMPONENT", "Unexpected relationship metadata."); empty(rel);
  for (const item of resources) descriptor(metadata(source.get(`WebResources/${item.file}.data.xml`)), item, expectedVersion, false);
  const browser = await boundedFile(root, "dist/vbd.toolkit.js");
  noSensitiveContent(browser);
  requireThat(decode(browser).includes('"VBD"') && decode(browser).includes("DUPLICATE_INITIALIZATION"),
    "BUILD_ASSET", "Expected the compiled VBD browser bundle, not ESM/CLI/source.");
  const reproduced = await reproduceBrowser(root);
  requireThat(sha256(browser) === sha256(reproduced.browser), "STALE_BUILD",
    "dist/vbd.toolkit.js differs from a fresh in-memory build of this source; run npm run build.");
  const notices = await boundedFile(root, "dist/THIRD-PARTY-NOTICES.txt", limits.notice);
  noSensitiveContent(notices);
  requireThat(sha256(notices) === sha256(reproduced.notices), "NOTICES",
    "Notice differs from all actually bundled dependency licenses; rebuild with the locked dependencies and shared contract.");
  const payloads = [browser, noticesHtml(notices)];
  const hashes = Object.fromEntries([...source].map(([name, bytes]) => [`solution/${name}`, sha256(bytes)]));
  hashes["package.json"] = sha256(packageBytes);
  hashes["dist/vbd.toolkit.js"] = sha256(browser);
  hashes["dist/THIRD-PARTY-NOTICES.txt"] = sha256(notices);
  for (const file of ["package-lock.json", "scripts/build.mjs", "scripts/bundle-contract.mjs",
    "tools/packaging/package.mjs", "tools/packaging/formats.mjs", "tsconfig.json", "tsconfig.build.json"]) {
    hashes[file] = sha256(await boundedFile(root, file, limits.entry));
  }
  for (const file of await inventory(root, "src", runtimeInventory)) {
    hashes[`src/${file}`] = sha256(await boundedFile(root, `src/${file}`, limits.entry));
  }
  for (const [file, bytes] of reproduced.files) hashes[file] = sha256(bytes);
  return { version: expectedVersion, source, payloads, hashes, runtimeDependencies: reproduced.packages };
}
export function inspectArchive(bytes, expected, { kind = "unmanaged", checksum, format = "pac" } = {}) {
  requireThat(["unmanaged", "managed"].includes(kind), "KIND", "Only unmanaged or managed-export inspection is supported.");
  requireThat(typeof checksum === "string" && /^[a-f0-9]{64}$/.test(checksum), "CHECKSUM", "An explicit lowercase SHA-256 is required.");
  requireThat(sha256(bytes) === checksum, "CHECKSUM", "Archive SHA-256 mismatch.");
  const entries = readZip(bytes, { format });
  const exported = format === "dataverseExport";
  const get = (name) => {
    requireThat(entries.has(name), "COMPONENT", `Missing required archive entry ${name}.`);
    return entries.get(name);
  };
  manifest(get("solution.xml"), expected.version, kind, exported);
  const paths = customizations(get("customizations.xml"), expected.version, true, exported);
  const allowed = ["solution.xml", "customizations.xml", "[Content_Types].xml", ...paths];
  requireThat(new Set(paths).size === resources.length && entries.size === allowed.length
    && [...entries.keys()].every((name) => allowed.includes(name)),
  "COMPONENT", "Archive has extra components/files or duplicate payload references.");
  const types = xml(get("[Content_Types].xml"));
  const contentTypesValid = exported
    ? types.children.filter(node => node.name === "Default").length === 1
      && types.children.filter(node => node.name === "Override").length === 2
      && new Set(types.children.filter(node => node.name === "Override").map(node => node.attrs.PartName)).size === 2
      && types.children.every(node =>
        ((node.name === "Default" && node.attrs.Extension === "xml") ||
         (node.name === "Override" && paths.some(path => node.attrs.PartName === `/${path}`)))
        && node.attrs.ContentType === "application/octet-stream" && Object.keys(node.attrs).length === 2
        && !node.children.length && !node.text.trim())
    : new Set(types.children.map(node => node.attrs.Extension)).size === 3
      && types.children.every(node => node.name === "Default" && ["xml", "html", "js"].includes(node.attrs.Extension)
        && node.attrs.ContentType === "application/octet-stream" && Object.keys(node.attrs).length === 2
        && !node.children.length && !node.text.trim());
  requireThat(types.name === "Types" && types.attrs.xmlns === "http://schemas.openxmlformats.org/package/2006/content-types"
    && Object.keys(types.attrs).length === 1 && !types.text.trim() && types.children.length === 3
    && contentTypesValid, "COMPONENT", "Unexpected package content types.");
  paths.forEach((path, index) => {
    requireThat(sha256(get(path)) === sha256(expected.payloads[index]), "CHECKSUM", "Packaged payload does not match this build/notice.");
  });
  return {
    solution: identity, version: expected.version, kind, format, sha256: checksum,
    components: resources.map((item, index) => ({ name: item.name, type: item.type, path: paths[index], sha256: sha256(get(paths[index])) })),
    dependencies: [], runtimeDependencies: expected.runtimeDependencies,
    importTested: false, publicReleaseReady: false,
    taggedSourceVerified: false,
    managedProvenance: kind === "managed" ? "UNVERIFIED: authenticated export evidence and clean import still required" : "not-applicable"
  };
}
export function runPac(pac, args, cwd) {
  requireThat(typeof pac === "string" && pac.length > 0 && pac.length <= 1024 && !/[\r\n\0]/.test(pac), "CLI_PATH", "Supply a PAC executable path, not shell text.");
  const result = spawnSync(pac, args, { cwd, encoding: "utf8", shell: false, timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  if (result.error?.code === "ENOENT") throw new PackagingError("CLI_MISSING", "Install official PAC locally or pass --pac <executable>; no authentication is needed.");
  requireThat(!result.error && result.status === 0, "CLI_FAILED",
    `PAC ${args[0] === "solution" ? args[1] : "help"} failed/timed out (exit ${result.status ?? "unavailable"}). Check local PAC version/help; partial outputs are retained, never overwritten.`);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  requireThat(!/\b(?:error|warning)\s*:|not defined in customizations/i.test(output),
    "CLI_FAILED", "PAC reported missing components/warnings; inspect source and local CLI before retrying in a new directory.");
  return output;
}
async function newOutput(root, out) {
  requireThat(typeof out === "string" && /^artifacts\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(out),
    "OUTPUT_PATH", "Use a new artifacts/<run-name> directory, never an input or existing directory.");
  try { await mkdir(join(root, "artifacts")); }
  catch (error) { requireThat(error.code === "EEXIST", "OUTPUT_IO", "Cannot create artifacts directory."); }
  await regularPath(root, "artifacts");
  try { await mkdir(join(root, out)); }
  catch (error) {
    throw new PackagingError(error.code === "EEXIST" ? "NO_OVERWRITE" : "OUTPUT_IO",
      "Output must be a new directory; choose a fresh artifacts/<run-name>. Existing/partial outputs are retained.");
  }
  return join(root, out);
}
export async function build({ root = repository, out, pac = "pac", kind = "unmanaged", run = runPac } = {}) {
  requireThat(kind === "unmanaged", "MANAGED_EXPORT_REQUIRED",
    "Offline conversion to managed is unsupported. An authorized unmanaged import followed by genuine managed export and clean-target validation is required.");
  out = portableInput(out);
  const expected = await inputs(root);
  const cli = run(pac, ["help"], root);
  requireThat(/Microsoft PowerPlatform CLI/.test(cli) && /Version:\s*\d/.test(cli), "CLI_VERSION", "PAC identity/version could not be established.");
  for (const action of ["pack", "unpack"]) {
    const help = run(pac, ["solution", action, "help"], root);
    requireThat(help.includes("--zipfile") && help.includes("--folder") && help.includes("--packagetype"),
      "CLI_CONTRACT", "This PAC version does not expose the required offline pack/unpack options.");
  }
  const output = await newOutput(root, out);
  const stage = join(output, "source");
  for (const [file, bytes] of expected.source) {
    let text = decode(bytes);
    // PAC uses name-based WebResource roots. ID-based roots duplicate its roots.
    const item = resources.find((r) => file === `WebResources/${r.file}.data.xml`);
    if (item) text = text.replace('<WebResource xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
      `<WebResource xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><WebResourceId>${componentId(item.name)}</WebResourceId>`);
    await mkdir(dirname(join(stage, file)), { recursive: true });
    await writeFile(join(stage, file), text, { flag: "wx" });
  }
  for (const [index, item] of resources.entries()) {
    await writeFile(join(stage, "WebResources", item.file), expected.payloads[index], { flag: "wx" });
  }
  const name = `${identity}_${expected.version}_unmanaged.zip`;
  const archive = join(output, name);
  const packLog = run(pac, ["solution", "pack", "--zipfile", archive, "--folder", stage, "--packagetype", "Unmanaged"], root);
  await writeFile(join(output, "pack.txt"), packLog, { flag: "wx" });
  const bytes = await boundedFile(root, relative(root, archive), limits.archive);
  const report = inspectArchive(bytes, expected, { checksum: sha256(bytes) });
  // Validate BEFORE any external extractor sees the ZIP. Destination is fresh.
  const unpackLog = run(pac, ["solution", "unpack", "--zipfile", archive, "--folder", join(output, "unpacked"), "--packagetype", "Unmanaged"], root);
  await writeFile(join(output, "unpack.txt"), unpackLog, { flag: "wx" });
  const unpacked = `${out}/unpacked`;
  const actual = await inventory(root, unpacked);
  const wanted = ["Other/Solution.xml", "Other/Customizations.xml",
    ...resources.flatMap((item) => [`WebResources/${item.name}`, `WebResources/${item.name}.data.xml`])].sort();
  requireThat(JSON.stringify(actual) === JSON.stringify(wanted), "ROUNDTRIP", "PAC unpacked component inventory differs.");
  manifest(await boundedFile(root, `${unpacked}/Other/Solution.xml`, limits.xml), expected.version, "unmanaged");
  customizations(await boundedFile(root, `${unpacked}/Other/Customizations.xml`, limits.xml), expected.version, false);
  for (const [index, item] of resources.entries()) {
    descriptor(metadata(await boundedFile(root, `${unpacked}/WebResources/${item.name}.data.xml`, limits.xml)), item, expected.version, true);
    requireThat(sha256(await boundedFile(root, `${unpacked}/WebResources/${item.name}`)) === sha256(expected.payloads[index]),
      "ROUNDTRIP", "Unpacked payload changed.");
  }
  // Repack the actual unpacked source too; compare semantics, not ZIP timestamps.
  const repacked = join(output, "roundtrip.zip");
  const repackLog = run(pac, ["solution", "pack", "--zipfile", repacked, "--folder", join(output, "unpacked"), "--packagetype", "Unmanaged"], root);
  await writeFile(join(output, "repack.txt"), repackLog, { flag: "wx" });
  const roundtrip = await boundedFile(root, relative(root, repacked), limits.archive);
  inspectArchive(roundtrip, expected, { checksum: sha256(roundtrip) });
  const after = await inputs(root);
  requireThat(JSON.stringify(expected.hashes) === JSON.stringify(after.hashes), "INPUT_CHANGED", "Inputs changed during packaging; do not use partial output.");
  const receipt = {
    ...report, validation: "local PAC pack/unpack/repack and bounded structural/payload inspection",
    pac: cli.match(/Version:\s*([^\r\n]+)/)[1], inputs: expected.hashes,
    roundtripSha256: sha256(roundtrip), license: "pending owner approval",
    reproducibility: "same input/content identities; ZIP byte identity is not promised (PAC timestamps)"
  };
  await writeFile(join(output, "evidence.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  await writeFile(join(output, "SHA256SUMS"), `${report.sha256}  ${name}\n${sha256(roundtrip)}  roundtrip.zip\n${sha256(Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`))}  evidence.json\n`, { flag: "wx" });
  return receipt;
}
export async function verify({ root = repository, file, checksum, kind = "unmanaged", format = "pac" } = {}) {
  file = portableInput(file);
  requireThat(typeof file === "string" && file.startsWith("artifacts/") && file.endsWith(".zip"),
    "PATH", "Copy an existing export into ignored artifacts/ under this worktree before inspection.");
  safeEntry(file);
  const expected = await inputs(root);
  return inspectArchive(await boundedFile(root, file, limits.archive), expected, { kind, checksum, format });
}
export async function cli(args) {
  const [command, ...rest] = args;
  requireThat(["build", "verify"].includes(command), "USAGE",
    "build --out artifacts/<new-name> [--pac <executable>] [--kind unmanaged] | verify --file artifacts/<file.zip> --sha256 <hex> [--kind managed] [--format dataverseExport]");
  const options = {};
  const allowed = command === "build" ? ["out", "pac", "kind"] : ["file", "sha256", "kind", "format"];
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].slice(2);
    const storedKey = key === "sha256" ? "checksum" : key;
    requireThat(rest[i].startsWith("--") && allowed.includes(key) && !Object.hasOwn(options, storedKey)
      && typeof rest[i + 1] === "string" && !rest[i + 1].startsWith("--"), "USAGE", "Unknown, duplicate or missing option value.");
    options[storedKey] = rest[i + 1];
  }
  return command === "build" ? build(options) : verify(options);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await cli(process.argv.slice(2)), null, 2)); }
  catch (error) {
    console.error(error instanceof PackagingError ? error.message : "IO: Local packaging failed; check file permissions and retained partial output, then use a new directory.");
    process.exitCode = 1;
  }
}
