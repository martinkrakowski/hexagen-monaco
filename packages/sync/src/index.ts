/**
 * Root barrel of `@hexagen-monaco/sync`.
 *
 * **The supported contract of this package is the `hexagen` binary**
 * (`dist/cli.js`), not this barrel — see ADR-0056. Under 0.x the barrel is
 * PROVISIONAL: names may be removed, and a removal rides a **minor**, never a
 * patch, and is named in that release's `CHANGELOG.md` section.
 *
 * `__tests__/contract/public-surface.contract.test.ts` snapshots every name
 * reachable from here. Changing this file changes that snapshot — which is the
 * point: an accidental widening or a silent removal shows up as a red test with
 * the exact names in the diff.
 *
 * Deliberately NOT re-exported (0.10.0, item 4.7 / D6):
 *   - `./infrastructure/adapters/in-memory-config-double.js` — a test double;
 *     shipping it made a fake part of the public surface.
 *   - `./infrastructure/adapters/yaml-config.adapter.js` — an infrastructure
 *     adapter; consumers drive it through the CLI, never by construction.
 *   - `./fs-utils.js` — internal write plumbing (`safeWriteFileAtomic` and
 *     friends) whose invariants only hold inside a `SyncConfig`-shaped run.
 * All three remain importable inside this package by their module path; only
 * the PUBLIC surface shrank.
 */
export * from "./sync-engine.js";
export * from "./config.js";
export * from "./results.js";
export * from "./types/index.js";
export * from "./domain/index.js";
export * from "./application/ports/out/index.js";
export * from "./manifest-service.js";
export { isIndexManifest, mergeSplitManifest } from "./loaders/index.js";
