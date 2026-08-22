/**
 * S7 — the leave-behind gate bundle, described for the screen that hands it over.
 *
 * WHAT THIS MODULE IS NOT: it does not build the bundle. BF-6.1 already owns
 * that end to end — `hexagenGateBundleFiles()` in
 * `packages/project-generation/src/domain/conformance-gate-files.ts` returns the
 * exact bytes, and `POST /api/projects/install-gate`
 * (`apps/web/app/api/projects/install-gate/route.ts`) zips them and streams the
 * result back with a `hexagen-gate-<scanId>.zip` `Content-Disposition`. The
 * download this screen triggers is that route, so the file the user receives is
 * BF-6.1's output byte for byte and this slice never re-derives a gate file.
 *
 * WHY THE PATHS ARE MIRRORED HERE RATHER THAN IMPORTED: S7 shows the user what
 * is inside the zip *before* they take it. Reading that list from
 * `@hexagen/project-generation` at render time would drag the whole package —
 * Octokit, JSZip, the node filesystem adapters — into a client bundle for four
 * strings, and the package's `exports` map has a single "." entry, so there is
 * no domain-only deep import to reach for instead. The mirror is therefore
 * deliberate, and it is NOT trusted to stay correct by inspection:
 * `gate-bundle-manifest.test.ts` asserts `GATE_BUNDLE_ENTRIES` against
 * `hexagenGateBundleFiles()` — same paths, same order — and asserts every
 * fragment of `GATE_PACKAGE_JSON_PATCH` against the real
 * `HEXAGEN_GATE_INSTALL_DOC`. Drift fails a test rather than misleading a user.
 *
 * Pure data + pure functions: no React, no DOM, no `use client`.
 */
import type { BrownfieldGateInstallMode } from "../BrownfieldFlow/types";

/** One file the bundle writes into the consumer's repository. */
export interface GateBundleEntry {
  /** Repository-relative path, exactly as it appears inside the zip. */
  readonly path: string;
  /** One line of plain English: why that file is in there. */
  readonly purpose: string;
}

/**
 * The bundle contents, in `hexagenGateBundleFiles()` order.
 *
 * ORDER IS PART OF THE CONTRACT upstream (the composite action's `action.yml`
 * at index 0, `post-comment.mjs` at index 1, new files appended), and the drift
 * test compares the two lists with `toEqual`, so a reorder here fails.
 */
export const GATE_BUNDLE_ENTRIES: readonly GateBundleEntry[] = [
  {
    path: ".github/actions/hexagen-conformance/action.yml",
    purpose:
      "Vendored composite action — runs the linter with the ratchet and checks the manifest is in sync.",
  },
  {
    path: ".github/actions/hexagen-conformance/post-comment.mjs",
    purpose:
      "Posts one pull-request comment naming only the violations that pull request introduced. Silent when it is clean.",
  },
  {
    path: ".github/workflows/sync-integrity.yml",
    purpose:
      "The workflow itself. Runs on every pull request and on pushes to the default branch.",
  },
  {
    path: "HEXAGEN-GATE-INSTALL.md",
    purpose:
      "Step-by-step install notes, including the package.json edits below. Delete it once the gate is in.",
  },
];

/**
 * npm range for the toolchain the vendored action invokes. Mirrors
 * `HEXAGEN_TOOLCHAIN_RANGE`; the action passes `--pr-diff`, `--base-ref` and
 * `--comment-file`, which older tarballs reject, so this must never be lowered
 * independently of the upstream constant.
 */
export const GATE_TOOLCHAIN_RANGE = "^0.11.0";

/**
 * The `packageManager` pin the workflow's Corepack step reads out of the
 * consumer's own `package.json`. Without it the CI run dies at "Prepare
 * package manager", which is the single most common first-run failure — so it
 * is the first line of the copyable patch, not a footnote.
 */
export const GATE_PACKAGE_MANAGER_PIN = "yarn@4.12.0";

/** Script name the workflow invokes as `yarn <name> --ratchet`. */
export const GATE_LINT_SCRIPT_NAME = "hexagen-lint";
export const GATE_LINT_SCRIPT_COMMAND = "hexagen-lint";

/** Script name the workflow invokes as `yarn <name>`. */
export const GATE_CHECK_SCRIPT_NAME = "sync:check";
export const GATE_CHECK_SCRIPT_COMMAND = "hexagen sync --check";

/** The two npm packages the gate needs on the consumer's dev dependency tree. */
export const GATE_TOOLCHAIN_PACKAGES = [
  "@hexagen-monaco/sync",
  "@hexagen-monaco/arch-linter",
] as const;

/**
 * Decision **D-B4**, rendered.
 *
 * The bundle deliberately does not rewrite a repository's `package.json` — that
 * is the one irreversible edit it could make to a repo it does not own, and we
 * know neither the consumer's package manager nor whether the file is
 * generated. So the screen shows the exact JSON to merge and lets the user copy
 * it; the wording around it must never suggest the download applies itself.
 *
 * Built with `JSON.stringify` rather than a hand-typed template so the block is
 * guaranteed to be valid JSON and so every value traces back to the constants
 * above (which the drift test checks against `HEXAGEN_GATE_INSTALL_DOC`).
 */
export const GATE_PACKAGE_JSON_PATCH = JSON.stringify(
  {
    packageManager: GATE_PACKAGE_MANAGER_PIN,
    scripts: {
      [GATE_LINT_SCRIPT_NAME]: GATE_LINT_SCRIPT_COMMAND,
      [GATE_CHECK_SCRIPT_NAME]: GATE_CHECK_SCRIPT_COMMAND,
    },
    devDependencies: {
      [GATE_TOOLCHAIN_PACKAGES[0]]: GATE_TOOLCHAIN_RANGE,
      [GATE_TOOLCHAIN_PACKAGES[1]]: GATE_TOOLCHAIN_RANGE,
    },
  },
  null,
  2,
);

/** BF-6.1's route. The only place a gate file is ever materialised. */
export const INSTALL_GATE_ENDPOINT = "/api/projects/install-gate";

/**
 * Flow vocabulary -> wire vocabulary.
 *
 * `BrownfieldGateInstallMode` ("download-zip" / "open-pr") is what the state
 * machine and the draft store speak; the route's `mode` field is the shorter
 * "zip" / "pr". Keeping the translation in one exported record means the screen
 * never hand-writes a wire literal, and a new mode added to the flow union
 * fails to typecheck here until it is mapped.
 */
export const GATE_INSTALL_ROUTE_MODE: Record<
  BrownfieldGateInstallMode,
  "zip" | "pr"
> = {
  "download-zip": "zip",
  "open-pr": "pr",
};

/**
 * Filename for the saved bundle.
 *
 * Mirrors the route's `Content-Disposition`. The hidden-anchor download path
 * reads the name from the anchor's `download` attribute, not from the response
 * header, so this has to agree with the server or the user gets a file whose
 * name does not match what the screen just promised them.
 */
export function gateBundleFileName(scanId: string): string {
  return `hexagen-gate-${scanId}.zip`;
}

/**
 * Same allow-list the route validates `scanId` against, applied before the
 * request so a malformed id produces an inline message instead of a 400 the
 * user has to interpret. Deliberately a mirror, not a weakening: the route
 * still enforces it, because a client-side check is a UX affordance and never
 * a security boundary.
 */
const SCAN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isInstallableScanId(scanId: string): boolean {
  return SCAN_ID_PATTERN.test(scanId);
}
