import { describe, expect, it } from "vitest";
import { buildPlayground } from "../tools/playground/package.mjs";
describe("optional Playground packer input boundaries", () => {
  it.each(["../outside", "solution", "artifacts/a/b", "artifacts/../outside", "C:\\outside"])(
    "rejects unsafe output %s", async output => {
      await expect(buildPlayground(output)).rejects.toThrow("fresh direct artifacts");
    });
});
describe.skipIf(!process.env.VBD_PLAYGROUND_PAC)("actual optional Playground PAC integration", () => {
  it("packs one native app/sitemap and three resources without bundling Core", async () => {
    const out = `artifacts/PlaygroundIntegration-${Date.now()}`;
    const report = await buildPlayground(out, process.env.VBD_PLAYGROUND_PAC);
    expect(report).toMatchObject({ solution: "VBDToolkitPlayground", version: "0.1.0.0", app: "vbd_ToolkitPlayground" });
    expect(report.payloads).toHaveLength(3);
    await expect(buildPlayground(out, process.env.VBD_PLAYGROUND_PAC)).rejects.toThrow();
  }, 120000);
});
