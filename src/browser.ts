import { Config } from "./configuration.js";
import { Diagnostics } from "./diagnostics.js";
import { VbdError } from "./errors.js";

if (Object.prototype.hasOwnProperty.call(globalThis, "VBD")) {
  throw new VbdError("DUPLICATE_INITIALIZATION", { operation: "initialize" });
}
Object.defineProperty(globalThis, "VBD", {
  value: Object.freeze({ Config, Diagnostics }),
  enumerable: true,
  writable: false,
  configurable: false
});
