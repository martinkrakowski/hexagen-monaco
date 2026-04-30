export type ByokError =
  | { kind: "invalid_key_format"; message: string; provider: string }
  | { kind: "encryption_failed"; message: string }
  | {
      kind: "decryption_failed";
      message: string;
      reason: "tag_failure" | "aad_mismatch" | "version_unknown";
    }
  | { kind: "key_revoked"; message: string; provider: string }
  | { kind: "key_not_found"; message: string; provider: string }
  | { kind: "provider_error"; message: string; statusCode: number }
  | { kind: "invalid_ciphertext"; message: string }
  | { kind: "metadata_store_error"; message: string }
  | { kind: "audit_log_error"; message: string }
  | { kind: "unauthenticated"; message: string }
  | {
      kind: "rate_limit_exceeded";
      message: string;
      limitType: string;
      resetAt: string;
    };
