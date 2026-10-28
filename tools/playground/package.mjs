import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runPac } from "../packaging/package.mjs";
import { readZip, sha256, xml, child, value } from "../packaging/formats.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceFiles = [
  "Other/Solution.xml", "Other/Customizations.xml", "Other/Relationships.xml",
  "AppModules/vbd_ToolkitPlayground/AppModule.xml",
  "AppModuleSiteMaps/vbd_ToolkitPlayground/AppModuleSiteMap.xml",
  ...["html", "js", "svg"].map(extension => `WebResources/vbd_playground.${extension}.data.xml`)
];
async function file(path, maximum = 2_097_152) {
  const full = join(root, path), stat = await lstat(full);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) {
    throw new Error("A required Playground input is not a bounded regular file.");
  }
  return readFile(full);
}
export function inspectPlayground(bytes) {
  const entries = readZip(bytes);
  const required = name => {
    const bytes = entries.get(name);
    if (!bytes) throw new Error(`Missing Playground package entry: ${name}`);
    return bytes;
  };
  const solution = child(xml(required("solution.xml")), "SolutionManifest");
  if (value(solution, "UniqueName") !== "VBDToolkitPlayground" || value(solution, "Version") !== "0.1.0.0" ||
      value(solution, "Managed") !== "0") throw new Error("Playground identity/version/kind differs.");
  const roots = child(solution, "RootComponents").children;
  const expectedNames = ["html", "js", "svg"].map(extension => `vbd_/playground/vbd.playground.${extension}`);
  if (roots.length !== 5 || roots.filter(node => node.attrs.type === "80" && node.attrs.schemaName === "vbd_ToolkitPlayground").length !== 1 ||
      roots.filter(node => node.attrs.type === "62" && node.attrs.schemaName === "vbd_ToolkitPlayground").length !== 1 ||
      roots.filter(node => node.attrs.type === "61").length !== 3 ||
      expectedNames.some(name => roots.filter(node => node.attrs.type === "61" && node.attrs.schemaName === name).length !== 1)) {
    throw new Error("Unexpected Playground root components.");
  }
  const dependencies = child(solution, "MissingDependencies").children;
  if (dependencies.length !== 1 || child(dependencies[0], "Required").attrs.schemaName !== "vbd_/toolkit/vbd.toolkit.js") {
    throw new Error("Only the separately installed Core library is an explicit dependency.");
  }
  const customizations = xml(required("customizations.xml"));
  for (const name of ["Entities", "Roles", "Workflows", "FieldSecurityProfiles", "EntityRelationships", "OrganizationSettings", "optionsets"]) {
    const node = child(customizations, name);
    if (node.children.length || node.text.trim()) throw new Error("Playground must not contain data/schema/security/flow customizations.");
  }
  const webresources = child(customizations, "WebResources").children;
  if (webresources.length !== 3 || child(customizations, "AppModules").children.length !== 1 ||
      child(customizations, "AppModuleSiteMaps").children.length !== 1) {
    throw new Error("Expected one app/sitemap and three Playground webresources.");
  }
  const payloads = webresources.map(node => {
    if (!expectedNames.includes(value(node, "Name"))) throw new Error("Unexpected companion resource name.");
    const path = value(node, "FileName").replace(/^\//, "");
    return { name: value(node, "Name"), path, sha256: sha256(required(path)) };
  });
  if (new Set(payloads.map(item => item.name)).size !== 3) throw new Error("Companion resource names must be unique.");
  const app = child(child(customizations, "AppModules"), "AppModule");
  if (value(app, "UniqueName") !== "vbd_ToolkitPlayground" || child(app, "AppModuleRoleMaps").children.length !== 0) {
    throw new Error("Unexpected app identity or app-role changes.");
  }
  const appComponents = child(app, "AppModuleComponents").children;
  if (appComponents.length !== 1 || appComponents[0].attrs.type !== "62" ||
      appComponents[0].attrs.schemaName !== "vbd_ToolkitPlayground") {
    throw new Error("The Playground app must reference only its sitemap, not unresolved webresource app-component IDs.");
  }
  const allowed = new Set(["solution.xml", "customizations.xml", "[Content_Types].xml", ...payloads.map(item => item.path)]);
  if (entries.size !== allowed.size || [...entries.keys()].some(name => !allowed.has(name))) {
    throw new Error("Unexpected extra Playground archive content.");
  }
  return { solution: "VBDToolkitPlayground", version: "0.1.0.0", sha256: sha256(bytes), app: "vbd_ToolkitPlayground", payloads };
}
export async function buildPlayground(out, pac = "pac") {
  if (typeof out !== "string" || !/^artifacts[\\/][A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(out)) {
    throw new Error("Choose a fresh direct artifacts directory.");
  }
  const output = join(root, out);
  await mkdir(join(root, "artifacts"), { recursive: true });
  if ((await lstat(join(root, "artifacts"))).isSymbolicLink()) throw new Error("Artifacts cannot be a linked directory.");
  await mkdir(output);
  const source = join(output, "source");
  for (const path of sourceFiles) {
    const bytes = await file(`playground/solution/${path}`, 262144);
    xml(bytes);
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), bytes, { flag: "wx" });
  }
  for (const extension of ["html", "js", "svg"]) {
    await writeFile(join(source, `WebResources/vbd_playground.${extension}`),
      await file(`dist/playground/vbd.playground.${extension}`), { flag: "wx" });
  }
  const zip = join(output, "VBDToolkitPlayground_0.1.0.0_unmanaged.zip");
  const log = runPac(pac, ["solution", "pack", "--zipfile", zip, "--folder", source, "--packagetype", "Unmanaged"], root);
  await writeFile(join(output, "pack.txt"), log, { flag: "wx" });
  const report = inspectPlayground(await readFile(zip));
  for (const payload of report.payloads) {
    const extension = payload.name.split(".").at(-1);
    if (payload.sha256 !== sha256(await file(`dist/playground/vbd.playground.${extension}`))) {
      throw new Error("Packaged Playground content differs from the built resource.");
    }
  }
  const unpackLog = runPac(pac, ["solution", "unpack", "--zipfile", zip, "--folder", join(output, "unpacked"), "--packagetype", "Unmanaged"], root);
  await writeFile(join(output, "unpack.txt"), unpackLog, { flag: "wx" });
  await writeFile(join(output, "evidence.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await buildPlayground(process.argv[2], process.argv[3]), null, 2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : "Playground packaging failed.");
    process.exitCode = 1;
  }
}
