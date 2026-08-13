/**
 * Discriminated union of persistence-specific errors.
 *
 * Part of the shared kernel — imported by monaco-orchestration and web-driver.
 */
export type PersistenceError =
  | { kind: "NotFound"; message: string }
  // A write was rejected because it would collide with an existing record
  // (e.g. createProjectRecord with a duplicate id).
  | { kind: "Conflict"; message: string }
  | { kind: "StorageQuotaExceeded"; message: string }
  | { kind: "SerializationFailed"; message: string; cause?: unknown }
  | { kind: "DeserializationFailed"; message: string; cause?: unknown }
  | { kind: "Unknown"; message: string; cause?: unknown };
