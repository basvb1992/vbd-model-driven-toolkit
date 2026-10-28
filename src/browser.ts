import { Config } from "./configuration.js";
import { Diagnostics } from "./diagnostics.js";
import { VbdError } from "./errors.js";
import { Environment } from "./environment.js";
import { Links } from "./links.js";
import { Launch } from "./launch.js";
import { Windows } from "./windows.js";

if (Object.prototype.hasOwnProperty.call(globalThis, "VBD")) {
  throw new VbdError("DUPLICATE_INITIALIZATION", { operation: "initialize" });
}
Object.defineProperty(globalThis, "VBD", {
  value: Object.freeze({ Config, Diagnostics, Environment, Links, Launch, Windows }),
  enumerable: true,
  writable: false,
  configurable: false
});
