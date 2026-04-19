/**
 * Discriminated union of all possible vault-related errors.
 * Used in Result<T, VaultError> returns from SecretVaultPort.
 */
export type VaultError =
  | { kind: "vault_empty"; message: string }
  | { kind: "vault_locked"; message: string }
  | { kind: "decryption_failed"; message: string }
  | { kind: "invalid_password"; message: string }
  | { kind: "encryption_failed"; message: string }
  | { kind: "storage_unavailable"; message: string }
  | { kind: "invalid_key"; message: string };
