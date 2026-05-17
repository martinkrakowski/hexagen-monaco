import type { Result } from "@hexagen/shared";
import type { SanitizedConfig } from "../../../domain/value-objects/sanitized-config.js";
import type { SecretLeakError } from "../../../domain/value-objects/sanitized-config.js";

/**
 * Port: Secret Scanner.
 * Scans raw configuration strings for leaked secrets.
 * Returns Result<T, E> — never throws.
 */
export interface ISecretScanner {
  /**
   * Scan a raw config string for secrets.
   * Returns sanitized config or structured error.
   */
  scan(rawConfig: string): Promise<Result<SanitizedConfig, SecretLeakError>>;
}
