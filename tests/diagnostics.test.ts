import { describe, expect, it, vi } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { Diagnostics, VbdError } from "../src/index.js";

describe("diagnostics", () => {
  it("matches the package version", () => {
    expect(Diagnostics.getVersion()).toBe(manifest.version);
  });

  it("retains the original cause without reflecting its message", () => {
    const original = new Error("TOKEN_CANARY https://private.example/?secret=VALUE_CANARY");
    const error = Diagnostics.normalizeError(original, { operation: "test" });
    expect(error.cause).toBe(original);
    expect(error.message).not.toContain("CANARY");
    expect(error.correlationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(error.operation).toBe("test");
  });

  it("preserves an existing structured error and correlation", () => {
    const original = new VbdError("CONFIG_NOT_FOUND", { operation: "config.get" });
    expect(Diagnostics.normalizeError(original, { operation: "caller" })).toBe(original);
  });

  it("reports only safe structured fields through an explicit sink", async () => {
    const sink = vi.fn();
    const error = new Error("SECRET_CANARY");
    const result = await Diagnostics.report(error, { operation: "test", sink });
    expect(result.reported).toBe(true);
    expect(sink).toHaveBeenCalledOnce();
    const payload: unknown = sink.mock.calls[0];
    expect(JSON.stringify(payload)).not.toMatch(/SECRET_CANARY|stack|cause/);
    expect(payload).toEqual([{
      code: "OPERATION_FAILED",
      message: "The operation failed. Use the correlation ID for diagnosis.",
      operation: "test",
      correlationId: result.correlationId
    }]);
  });

  it("awaits asynchronous sinks", async () => {
    const sink = vi.fn(async () => { await Promise.resolve(); });
    await expect(Diagnostics.report("unsafe message", { operation: "test", sink }))
      .resolves.toMatchObject({ reported: true });
    expect(sink).toHaveBeenCalledOnce();
  });

  it("surfaces sink failures instead of claiming delivery", async () => {
    const cause = new Error("SINK_CANARY");
    await expect(Diagnostics.report(new Error("ERROR_CANARY"), {
      operation: "test", sink: () => { throw cause; }
    })).rejects.toMatchObject({ code: "DIAGNOSTIC_SINK_FAILED", cause });
  });

  it("does not trust an error-shaped object from another source", async () => {
    const sink = vi.fn();
    await Diagnostics.report({ code: "CONFIG_NOT_FOUND", message: "CANARY" }, { operation: "test", sink });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ code: "OPERATION_FAILED" }));
    expect(JSON.stringify(sink.mock.calls)).not.toContain("CANARY");
  });

  it("does not report a structured error message modified by a caller", async () => {
    const sink = vi.fn();
    const error = new VbdError("CONFIG_NOT_FOUND", { operation: "test" });
    error.message = "MODIFIED_SECRET_CANARY";
    await Diagnostics.report(error, { operation: "test", sink });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({
      message: "The requested configuration is not registered."
    }));
    expect(JSON.stringify(sink.mock.calls)).not.toContain("MODIFIED_SECRET_CANARY");
  });
});
