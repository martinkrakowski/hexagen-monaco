import type { ISecretScanner } from "../../application/ports/in/secret-scanner.port.js";
import type { SanitizedConfig } from "../../domain/value-objects/sanitized-config.js";
import type { SecretLeakError } from "../../domain/value-objects/sanitized-config.js";
import type { Result } from "@hexagen/shared";

/**
 * TuffleHog-based secret scanner.
 * Uses regex patterns to detect common secret formats.
 */
export class TuffleHogAdapter implements ISecretScanner {
  private readonly secretPatterns = [
    /AKIA[0-9A-Z]{16}/g, // AWS Access Key
    /sk_live_[0-9a-zA-Z]{24}/g, // Stripe Live Secret
    /Bearer\s+[a-zA-Z0-9_.]{20,}/g, // Bearer token
    /api[_-]?key[_-]?[=:]?\s*[^\s"']+/gi, // API key
    /secret[_-]?[=:]?\s*[^\s"']+/gi, // Secret
    /password[_-]?[=:]?\s*[^\s"']+/gi, // Password
  ];

  async scan(
    rawConfig: string,
  ): Promise<Result<SanitizedConfig, SecretLeakError>> {
    try {
      const foundKeys: string[] = [];
      for (const pattern of this.secretPatterns) {
        const matches = rawConfig.match(pattern);
        if (matches) {
          foundKeys.push(...matches.map(() => `SECRET_AT_${Date.now()}`));
        }
      }

      if (foundKeys.length > 0) {
        // Redact secrets from the original config (in a real implementation)
        // For now, just return the dirty config
        return {
          success: true,
          value: {
            _tag: "SanitizedConfig",
            originalLength: rawConfig.length,
            redactedCount: foundKeys.length,
            redactedKeys: foundKeys,
            scanTimestamp: new Date(),
            isClean: false,
          },
        };
      }

      return {
        success: true,
        value: {
          _tag: "SanitizedConfig",
          originalLength: rawConfig.length,
          redactedCount: 0,
          redactedKeys: [],
          scanTimestamp: new Date(),
          isClean: true,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          _tag: "SecretLeakError",
          redactedKeys: [],
          scanTimestamp: new Date(),
        },
      };
    }
  }
}
