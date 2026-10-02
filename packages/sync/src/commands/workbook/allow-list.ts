import path from "node:path";
import {
  BUNDLE_FILE_ROLES,
  BUNDLE_FORBIDDEN_PATH_PATTERN,
} from "@hexagen/shared";

/**
 * What `hexagen workbook export` may ever put in a bundle or stage into the
 * client's history (plan BW-D1, §4.8). It is an allow-list: a file that is not
 * named here is never read, so a new secret file cannot slip in by accident.
 * The key and env pattern from BW0 is an independent second check.
 */

export type BundleRole = (typeof BUNDLE_FILE_ROLES)[number];

const forbidden = new RegExp(BUNDLE_FORBIDDEN_PATH_PATTERN);
const SAFE_NAME = "[A-Za-z0-9._-]+";
const GRANT_RE = new RegExp(`^grants/(${SAFE_NAME})\\.json$`);
const PROPOSAL_RE = new RegExp(`^proposals/(${SAFE_NAME})\\.(patch|json)$`);

/** Fixed top-level files, by path relative to `.hexagen/`. */
const FIXED: Readonly<Record<string, BundleRole>> = {
  "observed.json": "observed",
  "slice.json": "slice",
  "contract.json": "contract",
  "evidence/tip.json": "tip",
  "evidence/trace.jsonl": "evidence",
};

/** Bundle entries the export derives (the pack's verdicts); never read from disk, never stageable. */
const BUNDLE_ONLY: Readonly<Record<string, BundleRole>> = {
  "evidence/verdicts.json": "evidence",
};

export interface AllowedFile {
  /** Path relative to `.hexagen/` (forward slashes). */
  readonly source: string;
  /** Path inside the bundle. */
  readonly bundlePath: string;
  readonly role: BundleRole;
}

/** True for a key file, anything under a `keys/` directory, or an env file. */
export function isForbiddenPath(p: string): boolean {
  return forbidden.test(p.split(path.sep).join("/"));
}

/**
 * The allow-list entry for a path relative to `.hexagen/`, or null. The
 * forbidden-pattern check runs on the source path and again on the bundle path.
 */
export function allowListEntry(
  sourceRel: string,
  options: { readonly bundleOnly?: boolean } = {},
): AllowedFile | null {
  const source = sourceRel.split(path.sep).join("/");
  if (isForbiddenPath(source)) return null;
  let role: BundleRole | undefined = FIXED[source];
  if (role === undefined && options.bundleOnly === true) {
    role = BUNDLE_ONLY[source];
  }
  if (role === undefined && GRANT_RE.test(source)) role = "grant";
  if (role === undefined && PROPOSAL_RE.test(source)) role = "proposal";
  if (role === undefined) return null;
  // The bundle carries the tip at its top level; the rest keeps its name.
  const bundlePath = source === "evidence/tip.json" ? "tip.json" : source;
  if (isForbiddenPath(bundlePath)) return null;
  return { source, bundlePath, role };
}

/** True when `bundlePath` may be named inside a bundle: the allow-list, the derived verdicts and the top-level tip, and never a key or env path. */
export function bundlePathAllowed(bundlePath: string): boolean {
  if (isForbiddenPath(bundlePath)) return false;
  return (
    bundlePath === "tip.json" ||
    allowListEntry(bundlePath, { bundleOnly: true }) !== null
  );
}
