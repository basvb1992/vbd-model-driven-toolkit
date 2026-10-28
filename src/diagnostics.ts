import { isErrorCode, messageForCode, VbdError } from "./errors.js";
import { version } from "./version.js";

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
  getVersion: (): string => version
});
