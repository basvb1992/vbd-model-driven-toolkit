import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { cp, mkdir, mkdtemp, readFile, writeFile, lstat, symlink } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { build as esbuild } from "esbuild";
import { runInNewContext } from "node:vm";
import { browserBuildOptions, collectBundleNotices, NOTICE_HEADER } from "../../scripts/bundle-contract.mjs";
import {
  build, cli, inputs, inspectArchive, componentId, version, resources,
  repository, runPac, verify, noSensitiveContent, noticesHtml
} from "../../tools/packaging/package.mjs";
import { crc32, decode, limits, readZip, safeEntry, sha256, xml } from "../../tools/packaging/formats.mjs";
const packageVersion = JSON.parse(await readFile(join(repository, "package.json"), "utf8")).version;
const solutionVersion = `${packageVersion}.0`;

// These fixtures are CONSTRUCTED archives, not PAC or Dataverse export evidence.
function zip(entries, { method = 0, flags = 0, mode = 0 } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, input] of entries) {
    const data = Buffer.from(input), encoded = Buffer.from(name);
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(encoded.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(encoded.length, 28);
    central.writeUInt32LE(mode >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, encoded, compressed); centrals.push(central, encoded);
    offset += local.length + encoded.length + compressed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
async function fixture() {
  await mkdir(join(repository, "artifacts"), { recursive: true });
  const root = await mkdtemp(join(repository, "artifacts", "PackagingTest-"));
  await cp(join(repository, "solution"), join(root, "solution"), { recursive: true, force: false, errorOnExist: true });
  for (const file of ["package.json", "package-lock.json", "scripts/build.mjs", "scripts/bundle-contract.mjs",
    "tools/packaging/package.mjs", "tools/packaging/formats.mjs",
    "tsconfig.json", "tsconfig.build.json"]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await cp(join(repository, file), join(root, file), { force: false, errorOnExist: true });
  }
  await mkdir(join(root, "dist"));
  await mkdir(join(root, "src"));
  // Deliberately tiny compiled synthetic source; NOT the actual runtime bundle.
  await writeFile(join(root, "src/browser.ts"), 'const name="VBD";if(name)throw new Error("DUPLICATE_INITIALIZATION");');
  await writeFile(join(root, "src/version.ts"), `export const version = "${packageVersion}";\n`);
  await esbuild({
    ...browserBuildOptions, absWorkingDir: root
  });
  const notice = await collectBundleNotices(root, ["src/browser.ts"]);
  await writeFile(join(root, "dist/THIRD-PARTY-NOTICES.txt"), notice.text);
  return root;
}
async function replace(root, file, from, to) {
  const path = join(root, file), text = await readFile(path, "utf8");
  expect(text).toContain(from);
  await writeFile(path, text.replace(from, to));
}
async function addBundledPackage(root, name, packageVersion = "1.0.1") {
  const packageRoot = `node_modules/${name}`;
  await mkdir(join(root, packageRoot), { recursive: true });
  await writeFile(join(root, packageRoot, "index.js"), 'console.log("Synthetic dependency fixture");');
  await writeFile(join(root, packageRoot, "package.json"),
    JSON.stringify({ name, version: packageVersion, license: "MIT", main: "index.js" }));
  if (name === "@nodable/entities") {
    await mkdir(join(root, "third-party/licenses"), { recursive: true });
    await cp(join(repository, "third-party/licenses/nodable-entities-3.1.0.txt"),
      join(root, "third-party/licenses/nodable-entities-3.1.0.txt"));
  } else {
    await writeFile(join(root, packageRoot, "LICENSE"), "Synthetic MIT license fixture, not a distribution notice.\n");
  }
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  lock.packages[packageRoot] = { version: packageVersion, integrity: "sha512-synthetic-fixture" };
  await writeFile(join(root, "package-lock.json"), JSON.stringify(lock));
  const source = await readFile(join(root, "src/browser.ts"), "utf8");
  await writeFile(join(root, "src/browser.ts"), `import "../${packageRoot}/index.js";\n${source}`);
  await esbuild({ ...browserBuildOptions, absWorkingDir: root });
  const notice = await collectBundleNotices(root, [`${packageRoot}/index.js`]);
  await writeFile(join(root, "dist/THIRD-PARTY-NOTICES.txt"), notice.text);
}
function metadataWithId(bytes, item) {
  return decode(bytes).replace('<WebResource xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `<WebResource><WebResourceId>${componentId(item.name)}</WebResourceId>`);
}
function constructedEntries(expected) {
  const webresources = resources.map((item) =>
    metadataWithId(expected.source.get(`WebResources/${item.file}.data.xml`), item).replace(/^<\?xml[^>]+>\s*/, "")).join("");
  return [
    ["solution.xml", expected.source.get("Other/Solution.xml")],
    ["customizations.xml", decode(expected.source.get("Other/Customizations.xml")).replace("<WebResources />", `<WebResources>${webresources}</WebResources>`)],
    ["[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/octet-stream" /><Default Extension="js" ContentType="application/octet-stream" /><Default Extension="html" ContentType="application/octet-stream" /></Types>'],
    ...resources.map((item, index) => [`WebResources/${item.file}`, expected.payloads[index]])
  ];
}
function inspect(bytes, expected, options = {}) {
  return inspectArchive(bytes, expected, { checksum: sha256(bytes), ...options });
}
function mockPac(expected, calls, fail = false) {
  return (pac, args) => {
    calls.push(args);
    if (args[0] === "help") return "Microsoft PowerPlatform CLI\nVersion: 0.0.0-test\n";
    if (args.at(-1) === "help") return "--zipfile --folder --packagetype";
    if (fail) throw Object.assign(new Error("mock failure"), { code: "MOCK_FAILURE" });
    throw new Error("This mock must never be treated as actual PAC packaging.");
  };
}

describe("bounded contracts (unit/constructed, not PAC)", () => {
  it.each(["0.2.0.0", "1.2.3.65535", "65535.0.0.1"])("accepts canonical version %s", (text) => {
    expect(version(text)).toBe(text);
  });
  it.each(["1.2", "1.2.3", "01.2.3.4", "1.2.3.-1", "1.2.3.65536", "1.2.3.0-beta", "1.2.3.4\n", null])(
    "rejects invalid version %s", (text) => expect(() => version(text)).toThrow("VERSION"));
  it.each(["../a", "/a", "C:/a", "a\\b", "a//b", "a/../b", "a/./b", "a%2fb", "a:b", "a/CON.js", "NUL", "a.", "a/", "a\u0000b", "a".repeat(181)])(
    "rejects unsafe portable paths %s", (text) => expect(() => safeEntry(text)).toThrow("PATH"));
  it("uses stable name-derived component IDs, independent of release versions", () => {
    expect(componentId(resources[0].name)).toBe(componentId(resources[0].name));
    expect(componentId(resources[0].name)).not.toBe(componentId(resources[1].name));
    expect(componentId(resources[0].name)).toMatch(/^\{[\da-f]{8}-[\da-f]{4}-8[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\}$/);
  });
  it.each([
    '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///test">]><a/>',
    "<a>&unknown;</a>", "<a><b></a>", '<a x="1" x="2"/>', "<a/><b/>", "<?bad?><a/>", "<a><!-- comment --></a>"
  ])("rejects ambiguous/unsafe XML", (text) => expect(() => xml(Buffer.from(text))).toThrow("XML"));
  it("bounds and validates UTF-8 XML", () => {
    expect(() => xml(Buffer.alloc(limits.xml + 1))).toThrow("XML_LIMIT");
    expect(() => xml(Buffer.from([0xff]))).toThrow("ENCODING");
    expect(xml(Buffer.from('<a text="&amp;">&lt;</a>')).text).toBe("<");
  });
  it.each([
    "https://tenant.crm4.dynamics.com", "-----BEGIN PRIVATE KEY-----",
    'client_secret="SECRET_CANARY_1234567890"', "AccountKey=SECRET_CANARY_1234567890",
    "eyJabcdefghijklmno.abcdefghijklmnop.abcdefghijklmnop"
  ])("rejects sensitive content without reflecting it", (text) => {
    expect(() => noSensitiveContent(Buffer.from(text))).toThrow("SENSITIVE_INPUT");
    try { noSensitiveContent(Buffer.from(text)); } catch (error) { expect(error.message).not.toContain("CANARY"); }
  });
  it("requires a real third-party notice and escapes HTML", () => {
    expect(() => noticesHtml(Buffer.from("Zod\ntruncated"))).toThrow("NOTICES");
    const text = `${NOTICE_HEADER}MIT License\nPermission is hereby granted\n${"<script>&".repeat(12)}`;
    expect(decode(noticesHtml(Buffer.from(text)))).toContain("&lt;script&gt;&amp;");
  });
  it("validates stored and actual PAC-style deflate ZIP flags", () => {
    for (const options of [{}, { method: 8, flags: 2 }]) {
      expect(decode(readZip(zip([["file.js", "payload"]], options)).get("file.js"))).toBe("payload");
    }
  });
  it.each(["../escape", "/absolute", "a\\b", "a//b", "a/CON"])("rejects archive traversal %s before extraction", (name) => {
    expect(() => readZip(zip([[name, "payload"]]))).toThrow("PATH");
  });
  it("rejects duplicate/case collision, encryption, symlinks and unsupported compression", () => {
    expect(() => readZip(zip([["a", "x"], ["A", "y"]]))).toThrow("ZIP");
    for (const options of [{ flags: 1 }, { method: 99 }, { mode: 0xa0000000 }]) {
      expect(() => readZip(zip([["a", "x"]], options))).toThrow("ZIP");
    }
  });
  it("rejects local/central mismatch, corrupt data, overlap and oversized expansion", () => {
    const mismatch = zip([["a", "payload"]]); mismatch[30] = 98;
    expect(() => readZip(mismatch)).toThrow("ZIP");
    const corrupt = zip([["a", "payload"]]); corrupt[31] ^= 1;
    expect(() => readZip(corrupt)).toThrow("CHECKSUM");
    const overlap = zip([["a", "x"], ["b", "y"]]);
    const start = overlap.readUInt32LE(overlap.length - 6);
    overlap.writeUInt32LE(0, start + 47 + 42);
    expect(() => readZip(overlap)).toThrow("ZIP");
    expect(() => readZip(zip([["a", Buffer.alloc(limits.entry + 1)]], { method: 8 }))).toThrow("ZIP_LIMIT");
    expect(() => readZip(Buffer.alloc(limits.archive + 1))).toThrow("ZIP_LIMIT");
    expect(() => readZip(zip(Array.from({ length: 17 }, (_, i) => [`a${i}`, ""])))).toThrow("ZIP");
    expect(() => readZip(Buffer.from("not a ZIP"))).toThrow("ZIP_LIMIT");
  });
  it("rejects truncated archives, trailing data and archive comments", () => {
    const bytes = zip([["a", "x"]]);
    expect(() => readZip(bytes.subarray(0, -1))).toThrow("ZIP");
    expect(() => readZip(Buffer.concat([bytes, Buffer.from("SECRET_CANARY")]))).toThrow("ZIP");
    const comment = Buffer.from(bytes);
    comment.writeUInt16LE(1, comment.length - 2);
    expect(() => readZip(Buffer.concat([comment, Buffer.from("x")]))).toThrow("ZIP");
  });
});

describe("source/build/archive boundary (synthetic builds and constructed archives)", () => {
  it("fingerprints every expanded-core dependency and complete notice in the real current build", async () => {
    const expected = await inputs(repository);
    expect(expected.version).toBe(solutionVersion);
    expect(expected.runtimeDependencies.map((item) => item.name).sort()).toEqual([
      "@nodable/entities", "anynum", "fast-xml-builder", "fast-xml-parser", "is-unsafe",
      "path-expression-matcher", "strnum", "xml-naming", "zod"
    ]);
    for (const item of expected.runtimeDependencies) {
      expect(expected.hashes[`${item.root}/package.json`]).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(expected.hashes["node_modules/anynum/LICENSE"]).toMatch(/^[a-f0-9]{64}$/);
    expect(expected.hashes["third-party/licenses/nodable-entities-3.1.0.txt"]).toMatch(/^[a-f0-9]{64}$/);
    expect(expected.hashes["scripts/bundle-contract.mjs"]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("accepts the exact scoped-package fallback without broadening archive path grammar", async () => {
    const root = await fixture();
    await addBundledPackage(root, "@nodable/entities", "3.1.0");
    const expected = await inputs(root);
    expect(expected.runtimeDependencies).toEqual([
      { name: "@nodable/entities", version: "3.1.0", root: "node_modules/@nodable/entities" }
    ]);
    expect(() => safeEntry("node_modules/@nodable/entities/index.js")).toThrow("PATH");
    await writeFile(join(root, "third-party/licenses/nodable-entities-3.1.0.txt"), "");
    await expect(collectBundleNotices(root, ["node_modules/@nodable/entities/index.js"])).rejects.toThrow("Empty bundled license");
    await expect(inputs(root)).rejects.toThrow("INPUT_SIZE");
    await replace(root, "node_modules/@nodable/entities/package.json", "3.1.0", "3.1.1");
    await expect(inputs(root)).rejects.toThrow("BUILD_REPRODUCE");
  });
  it("rejects unreviewed packages even when their local bundle and notices agree", async () => {
    const root = await fixture();
    await addBundledPackage(root, "unreviewed-library");
    await expect(inputs(root)).rejects.toThrow("BUILD_DEPENDENCY");
  });
  it("rejects installed dependency versions that differ from the supplied lock", async () => {
    const root = await fixture();
    await addBundledPackage(root, "anynum");
    await expect(inputs(root)).resolves.toHaveProperty("runtimeDependencies");
    await replace(root, "node_modules/anynum/package.json", "1.0.1", "1.0.2");
    await expect(inputs(root)).rejects.toThrow("BUILD_DEPENDENCY");
  });
  it("rejects incomplete non-Zod notices, empty licenses and mismatched package identities", async () => {
    const root = await fixture();
    await addBundledPackage(root, "anynum");
    await writeFile(join(root, "node_modules/anynum/LICENSE"), "Truncated fixture license.\n");
    await expect(inputs(root)).rejects.toThrow("NOTICES");
    await writeFile(join(root, "node_modules/anynum/LICENSE"), "");
    await expect(inputs(root)).rejects.toThrow("INPUT_SIZE");
    await expect(collectBundleNotices(root, ["node_modules/anynum/index.js"])).rejects.toThrow("Empty bundled license");
    await replace(root, "node_modules/anynum/package.json", '"name":"anynum"', '"name":"other-package"');
    await expect(inputs(root)).rejects.toThrow("BUILD_REPRODUCE");
  });
  it("accepts only the two independent resources and unchanged build bytes", async () => {
    const expected = await inputs(await fixture()), archive = zip(constructedEntries(expected));
    expect(inspect(archive, expected)).toMatchObject({
      version: solutionVersion, dependencies: [], runtimeDependencies: [], importTested: false, publicReleaseReady: false
    });
    expect(inspect(archive, expected).components.map((c) => c.name)).toEqual(resources.map((r) => r.name));
    expect(() => inspect(archive, expected, { checksum: "0".repeat(64) })).toThrow("CHECKSUM");
    expect(() => inspectArchive(archive, expected)).toThrow("CHECKSUM");
  });
  it.each([
    ["Other/Solution.xml", "<MissingDependencies />", '<MissingDependencies><MissingDependency /></MissingDependencies>', "DEPENDENCY"],
    ["Other/Solution.xml", `<Version>${solutionVersion}</Version>`, "<Version>1.0.0.0</Version>", "IDENTITY"],
    ["Other/Solution.xml", "<CustomizationPrefix>vbd</CustomizationPrefix>", "<CustomizationPrefix>new</CustomizationPrefix>", "PREFIX"],
    ["Other/Solution.xml", "<Managed>0</Managed>", "<Managed>1</Managed>", "IDENTITY"],
    ["Other/Customizations.xml", "<Entities />", "<Entities><Entity /></Entities>", "DEPENDENCY"],
    ["Other/Solution.xml", "<Publisher>", '<Publisher environment="production">', "COMPONENT"],
    ["Other/Solution.xml", "<Publisher>", '<Publisher __proto__="unexpected">', "COMPONENT"],
    ["WebResources/vbd_toolkit.js.data.xml", "<WebResourceType>3", "<WebResourceType>1", "COMPONENT"],
    ["WebResources/vbd_toolkit.js.data.xml", "<Name>vbd_/", "<Name>customer_/", "COMPONENT"]
  ])("rejects invalid source %s", async (file, from, to, code) => {
    const root = await fixture(); await replace(root, `solution/${file}`, from, to);
    await expect(inputs(root)).rejects.toThrow(code);
  });
  it("pins the dedicated toolkit publisher rather than adopting the general VBD publisher", async () => {
    const root = await fixture(), path = join(root, "solution/Other/Solution.xml");
    const before = await readFile(path, "utf8");
    const after = before.replace(/(<Publisher>\s*<UniqueName>)VBDModelDrivenToolkit(<\/UniqueName>)/, "$1VBD$2");
    expect(after).not.toBe(before);
    await writeFile(path, after);
    await expect(inputs(root)).rejects.toThrow("PREFIX");
  });
  it("rejects extra solution files and missing build assets explicitly", async () => {
    const root = await fixture();
    await writeFile(join(root, "solution/unexpected.xml"), "<a/>");
    await expect(inputs(root)).rejects.toThrow("COMPONENT");
    const fresh = await fixture();
    // Missing path, no deletion of any file/directory.
    await expect(inputs(join(fresh, "absent"))).rejects.toThrow("MISSING_INPUT");
    const minimal = await mkdtemp(join(repository, "artifacts", "MissingBuild-"));
    await cp(join(repository, "solution"), join(minimal, "solution"), { recursive: true });
    await cp(join(repository, "package.json"), join(minimal, "package.json"));
    await mkdir(join(minimal, "src"));
    await cp(join(repository, "src/version.ts"), join(minimal, "src/version.ts"));
    await expect(inputs(minimal)).rejects.toThrow("MISSING_INPUT");
  });
  it("rejects empty/wrong browser build and altered/incomplete license notices", async () => {
    const root = await fixture();
    await writeFile(join(root, "dist/vbd.toolkit.js"), "");
    await expect(inputs(root)).rejects.toThrow("INPUT_SIZE");
    await writeFile(join(root, "dist/vbd.toolkit.js"), "export const CLI = {};");
    await expect(inputs(root)).rejects.toThrow("BUILD_ASSET");
    const stale = await fixture();
    await writeFile(join(stale, "dist/vbd.toolkit.js"), '"VBD";throw new Error("DUPLICATE_INITIALIZATION");');
    await expect(inputs(stale)).rejects.toThrow("STALE_BUILD");
    const notices = await fixture();
    await writeFile(join(notices, "dist/THIRD-PARTY-NOTICES.txt"), "Zod\nMIT License\nPermission is hereby granted\ntruncated");
    await expect(inputs(notices)).rejects.toThrow("NOTICES");
  });
  it("rejects unstable/mismatched package and runtime versions", async () => {
    const root = await fixture();
    await replace(root, "package.json", `"version": "${packageVersion}"`, `"version": "${packageVersion}-beta.1"`);
    await expect(inputs(root)).rejects.toThrow("VERSION");
    const mismatch = await fixture();
    await writeFile(join(mismatch, "src/version.ts"), 'export const version = "9.0.0";');
    await expect(inputs(mismatch)).rejects.toThrow("VERSION");
  });
  it("rejects source symlinks/junctions", async () => {
    const root = await fixture();
    await symlink(join(root, "dist"), join(root, "solution", "link"), process.platform === "win32" ? "junction" : "dir");
    await expect(inputs(root)).rejects.toThrow("PATH");
  });
  it("rejects runtime imports outside the reviewed Core packages and records source fingerprints", async () => {
    const root = await fixture();
    expect((await inputs(root)).hashes["src/browser.ts"]).toMatch(/^[a-f0-9]{64}$/);
    await mkdir(join(root, "studio"));
    await writeFile(join(root, "studio/example.js"), 'console.log("Studio dependency");');
    await writeFile(join(root, "src/browser.ts"), 'import "../studio/example.js";const name="VBD";if(name)throw new Error("DUPLICATE_INITIALIZATION");');
    await esbuild({
      ...browserBuildOptions, absWorkingDir: root
    });
    await expect(inputs(root)).rejects.toThrow("BUILD_DEPENDENCY");
  });
  it("accepts more than 32 runtime source files and fingerprints every file", async () => {
    const root = await fixture();
    await Promise.all(Array.from({ length: 40 }, (_, i) =>
      writeFile(join(root, "src", `extra${i}.ts`), "export {};\n")));
    const expected = await inputs(root);
    expect(Object.keys(expected.hashes).filter((file) => file.startsWith("src/"))).toHaveLength(42);
    expect(expected.hashes["src/extra39.ts"]).toBe(sha256(Buffer.from("export {};\n")));
  });
  it("bounds runtime source inventories at 512 files/nodes, independently of the solution", async () => {
    const root = await fixture();
    await Promise.all(Array.from({ length: 510 }, (_, i) =>
      writeFile(join(root, "src", `extra${i}.ts`), "export {};\n")));
    expect(Object.keys((await inputs(root)).hashes).filter((file) => file.startsWith("src/"))).toHaveLength(512);
    await writeFile(join(root, "src/oneTooMany.ts"), "export {};\n");
    await expect(inputs(root)).rejects.toThrow("INVENTORY_LIMIT");
  });
  it("counts directories toward the 512-node runtime inventory limit", async () => {
    const root = await fixture();
    await Promise.all(Array.from({ length: 511 }, (_, i) => mkdir(join(root, "src", `dir${i}`))));
    await expect(inputs(root)).rejects.toThrow("512-node");
  });
  it("permits eight runtime directory levels but rejects a ninth", async () => {
    const root = await fixture(), nested = Array.from({ length: 8 }, (_, i) => `d${i}`).join("/");
    await mkdir(join(root, "src", nested), { recursive: true });
    await writeFile(join(root, "src", nested, "extra.ts"), "export {};\n");
    expect((await inputs(root)).hashes[`src/${nested}/extra.ts`]).toBe(sha256(Buffer.from("export {};\n")));
    await mkdir(join(root, "src", nested, "tooDeep"));
    await expect(inputs(root)).rejects.toThrow("8 directory levels");
  });
  it("retains the separate 16-file/32-node solution inventory limits", async () => {
    const files = await fixture();
    await Promise.all(Array.from({ length: 12 }, (_, i) =>
      writeFile(join(files, "solution", `extra${i}.xml`), "<extra />")));
    await expect(inputs(files)).rejects.toThrow("16-file");
    const nodes = await fixture();
    await Promise.all(Array.from({ length: 33 }, (_, i) => mkdir(join(nodes, "solution", `dir${i}`))));
    await expect(inputs(nodes)).rejects.toThrow("32-node");
  });
  it("accepts only blank/default generated publisher metadata, never contact values", async () => {
    const root = await fixture();
    await replace(root, "solution/Other/Solution.xml", "<Descriptions />",
      '<Descriptions /><EMailAddress xsi:nil="true"></EMailAddress><Addresses><Address><AddressNumber>1</AddressNumber><AddressTypeCode>1</AddressTypeCode><City xsi:nil="true"></City></Address></Addresses>');
    await expect(inputs(root)).resolves.toHaveProperty("version", solutionVersion);
    await replace(root, "solution/Other/Solution.xml", '<EMailAddress xsi:nil="true"></EMailAddress>', "<EMailAddress>SECRET_CANARY@example.invalid</EMailAddress>");
    await expect(inputs(root)).rejects.toThrow("SENSITIVE_INPUT");
  });
  it("rejects customer components, extra files, dependency and payload tampering in archives", async () => {
    const expected = await inputs(await fixture()), base = constructedEntries(expected);
    const bad = [
      [...base, ["customer.xml", "<a/>"]],
      base.map(([name, data]) => [name, name === "customizations.xml" ? decode(Buffer.from(data)).replace("<Entities />", "<Entities><Entity /></Entities>") : data]),
      base.map(([name, data]) => [name, name === "solution.xml" ? decode(Buffer.from(data)).replace("<MissingDependencies />", "<MissingDependencies><MissingDependency /></MissingDependencies>") : data]),
      base.map(([name, data]) => [name, name === "WebResources/vbd_toolkit.js" ? "bad bundle" : data]),
      base.map(([name, data]) => [name, name === "customizations.xml" ? decode(Buffer.from(data)).replace("vbd_/toolkit/vbd.toolkit.js", "customer_/toolkit.js") : data])
    ];
    for (const entries of bad) expect(() => inspect(zip(entries), expected)).toThrow();
  });
  it("never equates a constructed managed flag with genuine export/import evidence", async () => {
    const expected = await inputs(await fixture());
    const entries = constructedEntries(expected).map(([name, data]) => [name, name === "solution.xml"
      ? decode(Buffer.from(data)).replace("<Managed>0</Managed>", "<Managed>1</Managed>") : data]);
    // IN MEMORY ONLY: demonstrates that structural validation cannot prove export provenance.
    const candidate = inspect(zip(entries), expected, { kind: "managed" });
    expect(candidate.managedProvenance).toContain("UNVERIFIED");
    expect(candidate.importTested).toBe(false);
    expect(() => inspect(zip(entries), expected)).toThrow("IDENTITY");
    await expect(build({ kind: "managed" })).rejects.toThrow("MANAGED_EXPORT_REQUIRED");
    await expect(build({ kind: "both" })).rejects.toThrow("MANAGED_EXPORT_REQUIRED");
  });
  it("checks missing/unsupported CLI without authentication or output allocation", async () => {
    const root = await fixture();
    await expect(build({ root, out: "artifacts/missing", pac: join(root, "not-installed") })).rejects.toThrow("CLI_MISSING");
    await expect(lstat(join(root, "artifacts/missing"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(build({ root, out: "artifacts/bad", run: () => "not PAC" })).rejects.toThrow("CLI_VERSION");
    expect(() => runPac(process.execPath, ["-e", "process.exit(4)"], root)).toThrow("CLI_FAILED");
  });
  it.each(["../escape", "dist", "solution", "artifacts/existing/child", "C:/escape", "artifacts/../escape",
    "..\\escape", "artifacts\\existing\\child", "artifacts\\..\\escape", "\\\\host\\share"])(
    "rejects unsafe output %s (mocked help only)", async (out) => {
      const calls = [], root = await fixture(), expected = await inputs(root);
      await expect(build({ root, out, run: mockPac(expected, calls) })).rejects.toThrow("OUTPUT_PATH");
      expect(calls.every((args) => args.at(-1) === "help")).toBe(true);
    });
  it.each(["artifacts/Native", "artifacts\\Native"])("accepts and canonicalizes output %s (mocked pack failure)", async (out) => {
    const root = await fixture(), calls = [];
    await expect(build({ root, out, run: mockPac(await inputs(root), calls, true) })).rejects.toThrow("mock failure");
    expect((await lstat(join(root, "artifacts/Native/source/Other/Solution.xml"))).isFile()).toBe(true);
    expect(calls.at(-1)).toContain(join(root, "artifacts/Native/source"));
  });
  it("refuses existing output before pack and preserves input/output sentinel (mocked help only)", async () => {
    const root = await fixture(), expected = await inputs(root), calls = [];
    await mkdir(join(root, "artifacts/existing"), { recursive: true });
    await writeFile(join(root, "artifacts/existing/sentinel"), "KEEP");
    await expect(build({ root, out: "artifacts/existing", run: mockPac(expected, calls) })).rejects.toThrow("NO_OVERWRITE");
    expect(await readFile(join(root, "artifacts/existing/sentinel"), "utf8")).toBe("KEEP");
    expect(calls.every((args) => args.at(-1) === "help")).toBe(true);
    expect((await inputs(root)).hashes).toEqual(expected.hashes);
  });
  it("rejects linked output ancestors without writing to their target (mocked help only)", async () => {
    const root = await fixture(), calls = [];
    await symlink(join(root, "dist"), join(root, "artifacts"), process.platform === "win32" ? "junction" : "dir");
    await expect(build({ root, out: "artifacts/new", run: mockPac(await inputs(root), calls) })).rejects.toThrow("PATH");
    await expect(lstat(join(root, "dist/new"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("retains partial source and never writes success evidence on pack failure (mocked)", async () => {
    const root = await fixture(), calls = [];
    await expect(build({ root, out: "artifacts/failed", run: mockPac(await inputs(root), calls, true) })).rejects.toThrow("mock failure");
    expect((await lstat(join(root, "artifacts/failed/source/Other/Solution.xml"))).isFile()).toBe(true);
    await expect(lstat(join(root, "artifacts/failed/evidence.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("checks export file bounds, missing evidence, checksum and unknown CLI options", async () => {
    const root = await fixture();
    await expect(verify({ root, file: "outside.zip", checksum: "a".repeat(64) })).rejects.toThrow("PATH");
    await expect(verify({ root, file: "artifacts/absent.zip", checksum: "a".repeat(64), kind: "managed" })).rejects.toThrow("MISSING_INPUT");
    for (const args of [[], ["import"], ["build", "--out"], ["build", "--token", "SECRET_CANARY"], ["build", "--out", "a", "--out", "b"],
      ["verify", "--sha256", "a".repeat(64), "--sha256", "b".repeat(64)]]) {
      await expect(cli(args)).rejects.toThrow("USAGE");
    }
    const result = spawnSync(process.execPath, [resolve("tools/packaging/package.mjs"), "build", "--token", "SECRET_CANARY"], { encoding: "utf8" });
    expect(result.status).toBe(1); expect(result.stderr).toContain("USAGE"); expect(result.stderr).not.toContain("CANARY");
  });
  it("accepts native/portable/mixed input separators but still rejects traversal (constructed archive)", async () => {
    const root = await fixture(), expected = await inputs(root), bytes = zip(constructedEntries(expected));
    await mkdir(join(root, "artifacts/Native"), { recursive: true });
    await writeFile(join(root, "artifacts/Native/candidate.zip"), bytes);
    for (const file of ["artifacts/Native/candidate.zip", "artifacts\\Native\\candidate.zip", "artifacts\\Native/candidate.zip"]) {
      expect((await verify({ root, file, checksum: sha256(bytes) })).sha256).toBe(sha256(bytes));
    }
    for (const file of ["artifacts\\Native\\..\\candidate.zip", "artifacts\\..\\candidate.zip", "C:\\artifacts\\candidate.zip", "\\\\host\\artifacts\\candidate.zip"]) {
      await expect(verify({ root, file, checksum: sha256(bytes) })).rejects.toThrow("PATH");
    }
    // Filesystem separator normalization must never loosen the archive contract.
    expect(() => readZip(zip([["WebResources\\escape.js", "bad"]]))).toThrow("PATH");
  });
});

// Explicit opt-in; absence is a SKIP, never a mocked success. No CLI installation/auth.
describe.skipIf(!process.env.VBD_PACKAGING_PAC)("actual local PAC offline integration", () => {
  it("packs/unpacks/repacks actual dist assets, verifies hashes and refuses overwrite", async () => {
    const out = `artifacts\\PacIntegration-${Date.now()}`;
    const portableOut = out.replaceAll("\\", "/");
    const report = await build({ out, pac: process.env.VBD_PACKAGING_PAC });
    expect(report.validation).toContain("local PAC pack/unpack/repack");
    expect(report.importTested).toBe(false);
    expect(report.dependencies).toEqual([]);
    expect(report.version).toBe(solutionVersion);
    expect(report.runtimeDependencies.map(item => item.name)).toEqual(expect.arrayContaining([
      "zod", "fast-xml-parser", "@nodable/entities"
    ]));
    const file = `${out}\\VBDModelDrivenToolkit_${report.version}_unmanaged.zip`;
    for (const input of [file, file.replaceAll("\\", "/")]) {
      expect((await verify({ file: input, checksum: report.sha256 })).sha256).toBe(report.sha256);
    }
    const archive = readZip(await readFile(join(repository, portableOut, `VBDModelDrivenToolkit_${report.version}_unmanaged.zip`)));
    const browser = archive.get(report.components[0].path);
    expect(browser).toBeDefined();
    const runtime = runInNewContext(`${decode(browser)}\nJSON.stringify({
      version: VBD.Diagnostics.getVersion(),
      count: Object.values(VBD).reduce((total, methods) => total + Object.keys(methods).length, 0)
    })`, { crypto: globalThis.crypto }, { timeout: 5000 });
    expect(JSON.parse(runtime)).toEqual({ version: packageVersion, count: 135 });
    await expect(build({ out: portableOut, pac: process.env.VBD_PACKAGING_PAC })).rejects.toThrow("NO_OVERWRITE");
    await expect(verify({ file, checksum: "0".repeat(64) })).rejects.toThrow("CHECKSUM");
  }, 120000);
});
