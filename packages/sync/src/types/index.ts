export type {
  Manifest,
  BoundedContext,
  LayerConfig,
  PlaneType,
  IndexBoundedContextEntry,
  IndexAppEntry,
  IndexManifest,
  RelationshipPattern,
  RelationshipRole,
  AclDefinition,
  Relationship,
  PortDefinition,
  LegacyOrNewPort,
} from "./manifest.js";

/**
 * `portName` and `sanitizeScope` are the two VALUE exports this barrel carries.
 *
 * `sanitizeScope` is surfaced for the brownfield ratification screen (S4) and
 * `POST /api/projects/bootstrap`, which both have to show or apply the SAME
 * npm-scope normalisation `hexagen bootstrap` applies when it writes
 * `manifest.yaml`. A consumer that reimplements it drifts from what the CLI
 * actually writes, and the user finds out only after the file has landed.
 *
 * This is the CANONICAL copy — `types/manifest/helpers.ts`, re-exported through
 * `types/manifest.ts`. It is deliberately not a second export of the private
 * duplicate `commands/bootstrap/index.ts` used to hold: that duplicate is gone
 * and now delegates here, so there is one implementation to keep correct rather
 * than two that happen to agree today.
 *
 * Adding a name here widens the surface pinned by
 * `__tests__/contract/public-surface.contract.test.ts` — see that file's header
 * for what a later removal would cost.
 */
export { portName, sanitizeScope } from "./manifest.js";
