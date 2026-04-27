import type { SecretVaultPort } from "../../domain/provider-config";

/**
 * Infrastructure adapter that retrieves secrets from environment variables.
 * Implements SecretVaultPort for Node.js runtime.
 */
export class EnvironmentSecretVaultAdapter implements SecretVaultPort {
  getSecret(envVarName: string): string | null {
    const value = process.env[envVarName];
    if (!value || value.trim().length === 0) {
      return null;
    }
    return value;
  }
}

// Made with Bob
