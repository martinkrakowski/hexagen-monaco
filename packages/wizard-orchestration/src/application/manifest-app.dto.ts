/**
 * The `apps[]` entries this context projects into a manifest (HEX-004).
 *
 * ## Why this type exists
 *
 * `wizardToManifest` used to reach these two positions by indexing the sync
 * engine's manifest type — `NonNullable<Manifest["apps"]>[number]["framework"]`
 * — which put an import edge from this context's application layer onto the
 * generator CLI package for the sake of a string union. Worse, `AppFramework`
 * is not part of `@hexagen/sync`'s public barrel, so the union was only
 * reachable by indexing *through* `Manifest`: this context was depending on an
 * internal type of another one, via a hole in its public surface.
 *
 * Wizard orchestration does not drive the generator. It produces a document;
 * something else generates from it. So it owns the vocabulary it emits.
 *
 * ## Why not `@hexagen/project-configuration`'s `Manifest`
 *
 * That was the review's primary recommendation and it was **refuted** in the
 * 2026-08-14 audit: project-configuration's Zod schema is looser than the
 * generator dialect and does not describe the same document. Swapping one
 * borrowed model for another borrowed model would not have made this context
 * own anything.
 *
 * ## The drift this deliberately accepts
 *
 * {@link ManifestAppFramework} is a *claim about what the wizard emits*, not a
 * mirror of the engine's `AppFramework`. The engine may grow a framework this
 * context never selects, and that is not drift. The failure that would matter is
 * the reverse — emitting a value the engine has no template for — and it is held
 * by `wizard-to-manifest.apps.test.ts`, which asserts the exact string each
 * wizard selection produces, plus the capstone fixture that runs the real engine
 * over this projection. Neither of those was available through a type import
 * either, so nothing was lost by dropping it.
 */
export type ManifestAppFramework =
  | "next.js"
  | "fastify"
  | "express"
  | "nestjs"
  | "serverless"
  | "plain-ts"
  | "nitro"
  | "vue"
  | "react-router"
  | "remix"
  | "angular";

/**
 * One entry of the manifest's `apps[]` array, restricted to the three keys this
 * projection sets. The engine's own app entry carries more (`driver`, `version`,
 * `description`); they are absent here because the wizard has nothing to say
 * about them, not because the engine dropped them.
 */
export interface ManifestAppEntry {
  name: string;
  framework: ManifestAppFramework;
  depends_on: string[];
}
