/**
 * The manifest as the *project-generation* context needs it (HEX-004).
 *
 * ## Why this type exists
 *
 * Generation's ports and use case used to be typed on `Manifest` imported from
 * `@hexagen/sync`, so the application contracts could not compile — or be
 * exercised — without the generator CLI. The engine is a driven dependency of
 * this context: it belongs behind `ExternalProjectGeneratorPort`, named only by
 * the adapter that constructs it.
 *
 * ## What this context actually reads
 *
 * Two fields, and nothing else:
 *   - `system` — the resolved project name, used for the add-on materializer's
 *     `{projectName}` interpolation;
 *   - `monorepo.packageManager` — decides whether the sync-integrity CI workflow
 *     is injected (`shouldInjectSyncIntegrityWorkflow`).
 *
 * Everything past those two keys is **generator dialect**: the engine owns it,
 * this context transports it. The open index signature says exactly that — the
 * rest of the document is carried opaquely to `generateAt` and interpreted
 * there. Restating the engine's full schema here would be a second, silently
 * drifting copy of a contract this context does not own.
 *
 * ## Why not `@hexagen/project-configuration`'s `Manifest`
 *
 * That was the review's primary recommendation and it was **refuted** in the
 * 2026-08-14 audit: project-configuration's Zod schema and the sync engine's
 * dialect are not the same document. The schema is looser in places and the
 * generator-specific sections are not in it at all, so importing it would have
 * swapped a wrong-but-honest coupling for a right-looking-but-wrong type. The
 * disposition is the parenthetical: a bounded-context-owned DTO.
 *
 * ## Contract with the engine
 *
 * Deliberately a *widening* of the engine's `Manifest`: the engine's own type is
 * assignable to this one, and this one is assignable back. The single place that
 * proves it is `ExternalSyncEngineAdapter`, which assigns a `GenerationManifest`
 * into the engine's parameter without a cast — if this DTO ever drifts into
 * something the engine cannot accept, that adapter stops compiling. Keep it that
 * way: a cast there would turn a compile error into a runtime surprise.
 */
export interface GenerationManifest {
  /** Resolved project/system name, set during manifest assembly. */
  system?: string;
  /**
   * Only `packageManager` is read here. Declared without an index signature on
   * purpose — the engine's `MonorepoConfig` is an `interface`, and TypeScript
   * gives implicit index signatures to type aliases only, so adding one would
   * break assignability from the engine's own manifests.
   */
  monorepo?: {
    packageManager?: string;
  };
  /** Generator dialect — carried through to the engine, not interpreted here. */
  [key: string]: unknown;
}
