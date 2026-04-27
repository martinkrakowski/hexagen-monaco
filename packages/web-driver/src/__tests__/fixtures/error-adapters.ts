/**
 * @module error-adapters
 * @description Error-injection infrastructure for testing failure scenarios.
 *
 * Provides reusable factories for creating adapters that simulate specific error conditions:
 * timeouts, validation failures, parse errors, auth failures, and network errors.
 *
 * All error adapters return standardized error codes for consistent error handling testing.
 */

import type { PortName } from "../../infrastructure/constants/port-names";

/**
 * Standard error codes for all error scenarios.
 * Ensures consistent error handling across all test suites.
 */
export enum ErrorScenario {
  TIMEOUT = "ETIMEDOUT",
  VALIDATION_ERROR = "VALIDATION_ERR",
  PARSE_ERROR = "PARSE_ERROR",
  WRITE_ERROR = "EACCES",
  AUTH_ERROR = "AUTH_ERROR",
  NETWORK_ERROR = "ENOTFOUND",
}

/**
 * Standard error type for all error adapters.
 * Provides type safety and consistent error structure across tests.
 */
export interface ErrorResult {
  success: false;
  error: {
    code: ErrorScenario | string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Create an error-injecting registry factory.
 * Pre-configures a registry with error-throwing adapters for a specific scenario.
 *
 * @param errorScenario The ErrorScenario to inject
 * @returns A factory function that creates pre-configured error-throwing adapters
 *
 * @example
 *   const errorFactory = createErrorInjectingRegistry(ErrorScenario.TIMEOUT);
 *   const timeoutAdapter = errorFactory();
 *   const result = await timeoutAdapter.execute();
 *   // result.success === false && result.error.code === 'ETIMEDOUT'
 */
export function createErrorInjectingRegistry(errorScenario: ErrorScenario): {
  createAdapter: <T = unknown>(
    portName?: PortName,
  ) => T & { execute?: () => Promise<ErrorResult> };
} {
  return {
    createAdapter: <T = unknown>(): T & {
      execute?: () => Promise<ErrorResult>;
    } => {
      const adapter = {
        async execute(): Promise<ErrorResult> {
          switch (errorScenario) {
            case ErrorScenario.TIMEOUT:
              throw new Error("Operation timed out");
            case ErrorScenario.VALIDATION_ERROR:
              throw new Error("Validation failed");
            case ErrorScenario.PARSE_ERROR:
              throw new Error("Parse error");
            case ErrorScenario.WRITE_ERROR:
              throw new Error("Permission denied");
            case ErrorScenario.AUTH_ERROR:
              throw new Error("Authentication failed");
            case ErrorScenario.NETWORK_ERROR:
              throw new Error("Network error");
            default:
              throw new Error("Unknown error scenario");
          }
        },
      };
      return adapter as T & { execute?: () => Promise<ErrorResult> };
    },
  };
}

/**
 * Create a timeout adapter that delays response beyond threshold.
 *
 * @param delayMs The delay in milliseconds before timeout
 * @returns An adapter that delays then throws a timeout error
 *
 * @example
 *   const adapter = createTimeoutAdapter(3000);
 *   const result = await adapter.execute(); // Throws after 3000ms
 */
export function createTimeoutAdapter<T = unknown>(
  delayMs: number,
): T & {
  execute: () => Promise<ErrorResult>;
} {
  return {
    async execute(): Promise<ErrorResult> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        success: false,
        error: {
          code: ErrorScenario.TIMEOUT,
          message: `Operation timed out after ${delayMs}ms`,
        },
      };
    },
  } as T & { execute: () => Promise<ErrorResult> };
}

/**
 * Create a failing adapter that always throws the specified error.
 *
 * @param error The error code to throw
 * @param message Optional error message
 * @returns An adapter that always fails with the specified error
 *
 * @example
 *   const adapter = createFailingAdapter(ErrorScenario.AUTH_ERROR, "Invalid token");
 *   const result = await adapter.execute(); // Throws auth error
 */
export function createFailingAdapter<T = unknown>(
  error: ErrorScenario | string,
  message: string = "Operation failed",
): T & { execute: () => Promise<ErrorResult> } {
  return {
    async execute(): Promise<ErrorResult> {
      return {
        success: false,
        error: {
          code: error,
          message,
        },
      };
    },
  } as T & { execute: () => Promise<ErrorResult> };
}

/**
 * Create a delayed adapter that mimics network latency or slow operations.
 *
 * @param delayMs The delay in milliseconds
 * @param shouldFail Whether the adapter should fail after the delay
 * @returns An adapter that delays then either succeeds or fails
 *
 * @example
 *   const adapter = createDelayedAdapter(500, false); // Succeeds after 500ms
 *   const result = await adapter.execute();
 */
export function createDelayedAdapter<T = unknown>(
  delayMs: number,
  shouldFail: boolean = false,
): T & { execute: () => Promise<{ success: boolean } | ErrorResult> } {
  return {
    async execute(): Promise<{ success: boolean } | ErrorResult> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (shouldFail) {
        return {
          success: false,
          error: {
            code: "DELAYED_ERROR",
            message: `Operation failed after ${delayMs}ms delay`,
          },
        };
      }
      return { success: true };
    },
  } as T & { execute: () => Promise<{ success: boolean } | ErrorResult> };
}

/**
 * Create a validation error adapter that rejects specific fields.
 *
 * @param fieldErrors Map of field names to error messages
 * @returns An adapter that fails with validation errors
 *
 * @example
 *   const adapter = createValidationErrorAdapter({
 *     projectName: "Invalid characters",
 *     description: "Too short"
 *   });
 */
export function createValidationErrorAdapter<T = unknown>(
  fieldErrors: Record<string, string>,
): T & { validate: () => Promise<ErrorResult> } {
  return {
    async validate(): Promise<ErrorResult> {
      return {
        success: false,
        error: {
          code: ErrorScenario.VALIDATION_ERROR,
          message: "Validation failed",
          details: fieldErrors,
        },
      };
    },
  } as T & { validate: () => Promise<ErrorResult> };
}

/**
 * Create a parse error adapter that fails during parsing.
 *
 * @param failureReason The reason for parse failure
 * @returns An adapter that fails with a parse error
 *
 * @example
 *   const adapter = createParseErrorAdapter("Unexpected token at line 5");
 *   const result = await adapter.parse();
 */
export function createParseErrorAdapter<T = unknown>(
  failureReason: string,
): T & { parse: () => Promise<ErrorResult> } {
  return {
    async parse(): Promise<ErrorResult> {
      return {
        success: false,
        error: {
          code: ErrorScenario.PARSE_ERROR,
          message: `Parse failed: ${failureReason}`,
        },
      };
    },
  } as T & { parse: () => Promise<ErrorResult> };
}

/**
 * Create an auth error adapter that fails with specific auth error.
 *
 * @param statusCode HTTP status code (401, 403, etc.)
 * @param reason The reason for auth failure
 * @returns An adapter that fails with an auth error
 *
 * @example
 *   const adapter = createAuthErrorAdapter(401, "Invalid token");
 */
export function createAuthErrorAdapter<T = unknown>(
  statusCode: number,
  reason: string,
): T & { authenticate: () => Promise<ErrorResult> } {
  return {
    async authenticate(): Promise<ErrorResult> {
      return {
        success: false,
        error: {
          code: ErrorScenario.AUTH_ERROR,
          message: `Auth failed (${statusCode}): ${reason}`,
          details: { statusCode },
        },
      };
    },
  } as T & { authenticate: () => Promise<ErrorResult> };
}

/**
 * Error code to severity mapping.
 * Used to classify errors for recovery decisions.
 */
export const ERROR_SEVERITY_MAP: Record<
  ErrorScenario | string,
  "HIGH" | "MEDIUM" | "LOW"
> = {
  [ErrorScenario.TIMEOUT]: "MEDIUM",
  [ErrorScenario.VALIDATION_ERROR]: "HIGH",
  [ErrorScenario.PARSE_ERROR]: "HIGH",
  [ErrorScenario.WRITE_ERROR]: "MEDIUM",
  [ErrorScenario.AUTH_ERROR]: "MEDIUM",
  [ErrorScenario.NETWORK_ERROR]: "MEDIUM",
};

/**
 * Error code to recoverability mapping.
 * Determines if an error is transient (retryable) or permanent.
 */
export const ERROR_RECOVERABILITY_MAP: Record<ErrorScenario | string, boolean> =
  {
    [ErrorScenario.TIMEOUT]: true, // Retryable
    [ErrorScenario.VALIDATION_ERROR]: false, // User must fix
    [ErrorScenario.PARSE_ERROR]: false, // Permanent
    [ErrorScenario.WRITE_ERROR]: true, // Might be transient
    [ErrorScenario.AUTH_ERROR]: false, // User must refresh token
    [ErrorScenario.NETWORK_ERROR]: true, // Retryable
  };
