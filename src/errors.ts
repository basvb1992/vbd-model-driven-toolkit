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
