/**
 * Discriminated union of persistence-specific errors.
 *
 * Part of the shared kernel — imported by monaco-orchestration and web-driver.
 */
export type PersistenceError =
  | { kind: "NotFound"; message: string }
  | { kind: "StorageQuotaExceeded"; message: string }
  | { kind: "SerializationFailed"; message: string; cause?: unknown }
  | { kind: "DeserializationFailed"; message: string; cause?: unknown }
  | { kind: "Unknown"; message: string; cause?: unknown };
