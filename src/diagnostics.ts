import { isErrorCode, messageForCode, VbdError } from "./errors.js";
import { version } from "./version.js";
import { isRecord } from "./validation.js";

const capabilityPaths = {
  navigation: [["Navigation", "navigateTo"]],
  quickCreate: [["Navigation", "openForm"]],
  lookups: [["Utility", "lookupObjects"]],
  environmentReads: [["Utility", "getGlobalContext"], ["WebApi", "retrieveMultipleRecords"]],
  sidePanes: [["App", "sidePanes", "createPane"], ["App", "sidePanes", "getPane"]],
  notifications: [["App", "addGlobalNotification"], ["App", "clearGlobalNotification"]]
} as const;
export type CapabilityName = keyof typeof capabilityPaths;
export interface CapabilityReport {
  toolkitVersion: string;
  basis: "methodPresenceOnly";
  capabilities: Record<CapabilityName, "present" | "absent">;
}
function getCapabilities(): CapabilityReport {
  const capabilities = {} as Record<CapabilityName, "present" | "absent">;
  try {
    const root: unknown = Reflect.get(globalThis, "Xrm");
    const present = (path: readonly string[]): boolean => {
      let value: unknown = root;
      for (const part of path) {
        if (!isRecord(value)) return false;
        value = value[part];
      }
      return typeof value === "function";
    };
    for (const name of Object.keys(capabilityPaths) as CapabilityName[]) {
      capabilities[name] = capabilityPaths[name].every(present) ? "present" : "absent";
    }
  } catch (cause) {
    throw new VbdError("SDK_OPERATION_FAILED", { operation: "diagnostics.capabilities", cause });
  }
  return { toolkitVersion: version, basis: "methodPresenceOnly", capabilities };
}

export interface Diagnostic {
  code: string;
  message: string;
  operation: string;
  correlationId: string;
}

export interface ReportOptions {
  operation: string;
  sink: (diagnostic: Readonly<Diagnostic>) => void | Promise<void>;
}

function normalizeError(error: unknown, options: { operation: string }): VbdError {
  return error instanceof VbdError && isErrorCode(error.code)
    ? error
    : new VbdError("OPERATION_FAILED", { operation: options.operation, cause: error });
}

async function report(error: unknown, options: ReportOptions): Promise<{
  correlationId: string;
  reported: true;
}> {
  if (typeof options.sink !== "function") {
    throw new VbdError("INVALID_ARGUMENT", { operation: "diagnostics.report" });
  }
  const normalized = normalizeError(error, options);
  const diagnostic = Object.freeze({
    code: normalized.code,
    message: messageForCode(normalized.code),
    operation: normalized.operation,
    correlationId: normalized.correlationId
  });
  try {
    await options.sink(diagnostic);
  } catch (cause) {
    throw new VbdError("DIAGNOSTIC_SINK_FAILED", {
      operation: "diagnostics.report",
      cause
    });
  }
  return { correlationId: normalized.correlationId, reported: true };
}

export const Diagnostics = Object.freeze({
  normalizeError,
  report,
  getCapabilities,
  getVersion: (): string => version
});
