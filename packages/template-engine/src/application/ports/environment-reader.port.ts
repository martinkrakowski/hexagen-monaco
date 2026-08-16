/**
 * Driven port: read a single environment variable.
 *
 * Returns the raw value (or `undefined` when unset) rather than a boolean
 * `isDefined`, so the **policy** — "unset means missing, empty string does
 * not" — stays in the use case and only the **capability** of reading the
 * environment moves to the adapter.
 *
 * The mirror test passes: `process.env` is one implementation; a parsed
 * `.env` file, a secrets-manager client, or a fixed record injected by a
 * hosted/browser build are others. Exposing `NodeJS.ProcessEnv` itself would
 * have failed it — that type is Node's, not this context's.
 */
export interface EnvironmentReaderPort {
  /** The value of `name`, or `undefined` when it is not set. */
  get(name: string): string | undefined;
}
