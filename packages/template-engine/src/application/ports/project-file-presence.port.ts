/**
 * Driven port: "is this file present in the project workspace?"
 *
 * Derived from what `ValidateTemplatesUseCase` actually consumes — a
 * yes/no answer about a **project-root-relative** output path — not from the
 * shape of `node:fs`. Deliberately NOT `access(absolutePath): Promise<void>`:
 * that is `node:fs`'s own contract (throw-on-missing, `errno`) and would force
 * the caller to join paths itself, which is exactly the leak this port removes.
 *
 * The mirror test — could a different implementation satisfy this? — passes:
 * a `node:fs` adapter joins and stats; an in-memory adapter answers from the
 * same relative-path keyed map that `InMemoryFileEmitter` already builds for
 * headless materialization (web code-view / ZIP / GitHub); a remote adapter
 * could answer from a repository tree listing. None of those is a filesystem
 * in the `node:fs` sense.
 *
 * `projectRoot` is passed per call rather than bound at construction, matching
 * `TemplateConfigStorePort` — the workspace is an argument of the
 * question, not state of the adapter.
 */
export interface ProjectFilePresencePort {
  /**
   * Whether `relativePath` (project-root-relative, posix or platform
   * separators as the manifest declared it) currently exists.
   *
   * Implementations answer `false` for anything they cannot read — an
   * unreadable path is indistinguishable from an absent one for validation
   * purposes, and validation must never throw on a permission quirk.
   */
  exists(projectRoot: string, relativePath: string): Promise<boolean>;
}
