import { z } from "zod";
import { VbdError } from "./errors.js";
import { validateAppUrl } from "./links.js";
import { isRecord, parseInput } from "./validation.js";

export interface WindowHost {
  isUserActivationActive(): boolean | undefined;
  open(url: string, target: string, features: string): unknown;
}
export const windowHostSchema = z.custom<WindowHost>((value) =>
  isRecord(value) && typeof value.isUserActivationActive === "function" && typeof value.open === "function"
);
const windowOptions = z.object({
  url: z.string().max(32768),
  allowedOrigins: z.array(z.string()).min(1).max(20),
  width: z.number().int().min(100).max(4096).optional(),
  height: z.number().int().min(100).max(4096).optional(),
  host: windowHostSchema.optional()
}).strict();
export type WindowOptions = z.input<typeof windowOptions>;
export interface LaunchResult {
  status: "requested";
  outcome: "unknown";
  isolation: "noopener,noreferrer";
}

function browserHost(): WindowHost {
  const open: unknown = Reflect.get(globalThis, "open");
  if (typeof open !== "function") {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "windows.open" });
  }
  return {
    isUserActivationActive: () => {
      const navigator: unknown = Reflect.get(globalThis, "navigator");
      if (!isRecord(navigator) || !isRecord(navigator.userActivation) ||
          typeof navigator.userActivation.isActive !== "boolean") {
        return undefined;
      }
      return navigator.userActivation.isActive;
    },
    open: (url, target, features) => {
      const result: unknown = Reflect.apply(open, globalThis, [url, target, features]);
      return result;
    }
  };
}

function open(input: WindowOptions): LaunchResult {
  const options = parseInput(windowOptions, input, "windows.open");
  const url = validateAppUrl(options.url, options.allowedOrigins);
  const host = options.host ?? browserHost();
  let activation: boolean | undefined;
  try {
    activation = host.isUserActivationActive();
  } catch (cause) {
    throw new VbdError("WINDOW_REQUEST_FAILED", { operation: "windows.open", cause });
  }
  if (activation === undefined) {
    throw new VbdError("UNSUPPORTED_SURFACE", { operation: "windows.open" });
  }
  if (activation !== true) {
    throw new VbdError("USER_ACTIVATION_REQUIRED", { operation: "windows.open" });
  }
  const features = [
    "noopener", "noreferrer",
    ...(options.width === undefined ? [] : [`width=${options.width}`]),
    ...(options.height === undefined ? [] : [`height=${options.height}`])
  ].join(",");
  try {
    host.open(url, "_blank", features);
  } catch (cause) {
    throw new VbdError("WINDOW_REQUEST_FAILED", { operation: "windows.open", cause });
  }
  return { status: "requested", outcome: "unknown", isolation: "noopener,noreferrer" };
}

export const Windows = Object.freeze({ open });
