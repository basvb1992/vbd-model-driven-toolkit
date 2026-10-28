const messages = {
  INVALID_ARGUMENT: "An argument is invalid. Check the documented input contract.",
  CONFIG_INVALID: "Configuration is invalid. Review the validation findings.",
  CONFIG_NOT_FOUND: "The requested configuration is not registered.",
  CONFIG_ALREADY_REGISTERED: "Configuration is already registered. Replacement must be explicit.",
  DUPLICATE_INITIALIZATION: "The VBD namespace already exists. Load one toolkit bundle per page.",
  DIAGNOSTIC_SINK_FAILED: "The diagnostic sink failed. The error was not successfully reported.",
  INVALID_JSON: "An input file is not valid JSON.",
  INPUT_TOO_LARGE: "An input file exceeds the 1 MiB limit.",
  INPUT_UNREADABLE: "An input file could not be read as a regular UTF-8 JSON file.",
  OUTPUT_EXISTS: "The output file already exists. Choose a new path.",
  OUTPUT_UNWRITABLE: "The output file could not be written.",
  UNSUPPORTED_SURFACE: "The required client capability or context is unavailable. Use a supported client or typed adapter.",
  DATA_READ_FAILED: "A configuration read failed. Inspect the retained cause using authorized diagnostics.",
  DATA_RESPONSE_INVALID: "The configuration service returned an unexpected response shape.",
  ACCESS_DENIED: "Configuration read access was denied. No missing-value fallback was applied.",
  CONFIG_AMBIGUOUS: "Configuration contains multiple or incompletely paged candidates. Resolve the ambiguity explicitly.",
  CONFIG_VALUE_MISSING: "The variable has no configured current or default value.",
  CONFIG_TYPE_MISMATCH: "The variable definition type does not match the requested type.",
  CONFIG_VALUE_INVALID: "The configuration value does not satisfy its declared type or validation policy.",
  SECRET_NOT_SUPPORTED: "Secret environment variables cannot be retrieved by the client toolkit.",
  UNSUPPORTED_VARIABLE_TYPE: "This environment-variable type is not supported for the requested client operation.",
  CONFIG_NOT_READY: "The prepared launch token is unknown. Prepare the registered profile first.",
  CONFIG_EXPIRED: "Configuration scope, freshness, or revision changed. Resolve and prepare it again.",
  LIMIT_EXCEEDED: "The operation exceeds the documented bounded capacity.",
  ENVIRONMENT_BATCH_FAILED: "An environment-variable batch failed. No partial success result was returned.",
  INVALID_URL: "The destination must satisfy the documented HTTPS app-link and approved-origin policy.",
  USER_ACTIVATION_REQUIRED: "A direct active user gesture is required before requesting a new window.",
  WINDOW_REQUEST_FAILED: "The browser window operation failed. Destination readiness is not known.",
  SDK_OPERATION_FAILED: "The supported client API operation failed. Inspect its retained cause with authorized diagnostics.",
  DATA_WRITE_FAILED: "The data write failed or its outcome is uncertain. Verify server state before retrying.",
  ACTION_FAILED: "The registered operation failed. A mutating request may have reached the server; verify before retrying.",
  MUTATION_OUTCOME_UNKNOWN: "The mutation outcome cannot be safely confirmed. Do not retry blindly or assume rollback.",
  CONCURRENCY_CONFLICT: "The record changed. Reload and reconcile before retrying.",
  FORM_TARGET_MISSING: "A configured form attribute, control, tab, or section is not loaded.",
  FIELD_TYPE_MISMATCH: "The value does not match the supported attribute type or lookup policy.",
  EVENT_REENTRY: "The operation attempted a recursive event dispatch.",
  UNSAVED_RECORD: "This operation requires a saved record.",
  DIRTY_FORM: "The form has unsaved edits. Choose an explicit save policy before refreshing or navigating.",
  PARTIAL_FAILURE: "The native host failed after part of the operation completed. Inspect and reconcile; no rollback is implied.",
  ERROR_PRESENTATION_FAILED: "The original error could not be presented. Both errors are retained for authorized diagnostics.",
  OPERATION_FAILED: "The operation failed. Use the correlation ID for diagnosis."
} as const;

export type ErrorCode = keyof typeof messages;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(messages, value);
}

export function messageForCode(code: ErrorCode): string {
  return messages[code];
}

export interface ErrorOptions {
  operation: string;
  cause?: unknown;
}

export class VbdError extends Error {
  readonly code: ErrorCode;
  readonly operation: string;
  readonly correlationId: string;

  constructor(code: ErrorCode, options: ErrorOptions) {
    super(messages[code], { cause: options.cause });
    this.name = "VbdError";
    this.code = code;
    this.operation = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(options.operation)
      ? options.operation
      : "operation";
    this.correlationId = globalThis.crypto.randomUUID();
  }
}
