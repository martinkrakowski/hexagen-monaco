/**
 * The architectural-integrity CI workflow auto-injected into generated
 * projects.
 *
 * The workflow bytes, the vendored `hexagen-conformance` composite action, and
 * the materializer that turns them into files now live in
 * `./conformance-gate-files.js`, so the brownfield "install the gate"
 * leave-behind and the greenfield generator emit the *same* bytes instead of
 * two copies that drift.
 *
 * This module keeps the injection **policy** (`shouldInjectSyncIntegrityWorkflow`)
 * and re-exports every name it used to own, verbatim. The re-export is not
 * vestigial: three in-repo call sites still import from this path, one of them
 * (`scripts/capstone/generate-fixture.ts`) via a deep relative specifier from
 * outside this package, where a moved path would fail at runtime rather than at
 * compile time. Prefer `./conformance-gate-files.js` in new code.
 */
export {
  HEXAGEN_CONFORMANCE_ACTION_YML,
  HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
  HEXAGEN_CONFORMANCE_COMMENT_SCRIPT,
  HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
  SYNC_INTEGRITY_WORKFLOW,
  SYNC_INTEGRITY_WORKFLOW_PATH,
  hexagenConformanceActionFiles,
} from "./conformance-gate-files.js";
export type {
  ConformanceGateFile,
  ConformanceGateFilesOptions,
} from "./conformance-gate-files.js";

/**
 * Auto-inject the workflow only for yarn-based projects. The workflow is
 * yarn-specific (`yarn install --immutable`, `yarn sync:check`), and generated
 * projects default to `yarn@4.12.0`. A `pnpm`/`bun` `packageManager` opts out
 * (no workflow beats a broken one); an absent/blank value is the yarn default.
 */
export function shouldInjectSyncIntegrityWorkflow(
  packageManager?: string,
): boolean {
  const pm = packageManager?.trim();
  if (!pm) return true; // default packageManager is yarn@4
  return /^yarn(@|$)/.test(pm);
}
