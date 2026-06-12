/**
 * Single source of truth for the toolchain's own version — the value the
 * scaffold pins its `@hexagen-monaco/*` devDependencies to (plan PR-A3,
 * RCA #1: the scaffold template hardcoded `^0.4.0` while the engine shipped
 * 0.6.0, so generated projects installed a four-minor-stale toolchain).
 *
 * Resolution order:
 *
 *   1. Build-injected constant (`__HEXAGEN_TOOLCHAIN_VERSION__`, tsup
 *      `define`). The published CLI and the wizard's Next.js server bundle
 *      both consume the tsup output (`dist/cli.js` / `dist/index.js` via the
 *      package's `main`/`exports`), so the literal is baked into every
 *      production path at build time — no filesystem layout assumptions.
 *   2. Reading `../package.json` relative to this module — ONLY reachable
 *      when executing straight from `src/` (tsx tests, dev), where the
 *      define doesn't exist and the workspace layout is guaranteed.
 *
 * This deliberately does NOT reuse the old `cli.ts · readVersion()` shape:
 * that helper resolved `../package.json` from `import.meta.url` and silently
 * fell back to `"0.0.0"`. The layout assumption holds in the published dist,
 * but inside a server bundle the path breaks — and the silent fallback would
 * have the deployed wizard scaffold `"^0.0.0"` pins that `yarn install`
 * resolves to nothing or to the wrong thing. A missing or degenerate version
 * therefore THROWS: never emit a degenerate pin.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Replaced with the package-version literal by tsup `define` (see
// tsup.config.ts). Under src execution the identifier stays undeclared, so it
// must only ever be touched behind a `typeof` guard.
declare const __HEXAGEN_TOOLCHAIN_VERSION__: string | undefined;

// The official SemVer 2.0.0 regex, verbatim from semver.org (review #316: a
// prefix check accepted "1.2.3junk"). Anchored full-string match; the allowed
// charset ([0-9A-Za-z.+-]) also guarantees the value cannot break the JSON
// string it is interpolated into in the scaffold's package.json. Kept
// dependency-free on purpose: `semver` is not a dependency of the published
// CLI, and this module runs inside every consumer bundle.
const SEMVER_2_0_0 =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Validate a candidate toolchain version: must be a FULL SemVer 2.0.0 version
 * string and must not be the degenerate `0.0.0` that the old silent fallback
 * produced. Returns the version on success, throws with the offending source
 * on failure. Shared by the runtime resolver below AND the tsup build gate
 * (tsup.config.ts imports it), so the two cannot drift apart.
 */
export function assertValidToolchainVersion(
  version: unknown,
  source: string,
): string {
  const invalid =
    typeof version !== "string" ||
    !SEMVER_2_0_0.test(version) ||
    /^0\.0\.0(?:$|[-+])/.test(version);
  if (invalid) {
    throw new Error(
      `Toolchain version unavailable, malformed, or degenerate (${source} → ` +
        `${JSON.stringify(version)}). Refusing to continue: the scaffold ` +
        `would pin @hexagen-monaco/* devDependencies to a version that does ` +
        `not exist (RCA #1 — never emit a degenerate pin).`,
    );
  }
  return version;
}

/**
 * Resolve the engine's own version (e.g. `0.7.0`). Throws instead of
 * returning a fallback — callers that scaffold pins must abort loudly.
 */
export function resolveToolchainVersion(): string {
  if (typeof __HEXAGEN_TOOLCHAIN_VERSION__ === "string") {
    return assertValidToolchainVersion(
      __HEXAGEN_TOOLCHAIN_VERSION__,
      "build-injected __HEXAGEN_TOOLCHAIN_VERSION__",
    );
  }
  // src execution (tsx) — dist always has the define, so a file read here in
  // a deployed artifact means the build itself is broken; the validator below
  // turns that into a loud failure either way.
  const pkgPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json",
  );
  let raw: string;
  try {
    raw = readFileSync(pkgPath, "utf8");
  } catch (err) {
    throw new Error(
      `Toolchain version unavailable: cannot read ${pkgPath} ` +
        `(${err instanceof Error ? err.message : String(err)}) — refusing to ` +
        `scaffold degenerate @hexagen-monaco/* pins (RCA #1).`,
    );
  }
  return assertValidToolchainVersion(
    (JSON.parse(raw) as { version?: unknown }).version,
    pkgPath,
  );
}
