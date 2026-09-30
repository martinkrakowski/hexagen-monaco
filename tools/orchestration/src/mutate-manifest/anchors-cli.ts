import {
  anchorExitCode,
  checkAnchors,
  formatAnchorReport,
  type AnchorDeps,
} from "./lib/anchors.js";

export const DEFAULT_MANIFEST_DIR = ".agents/manifests";
/** The directory could not be listed. Not "no manifests": a check that cannot look must not pass. */
export const EXIT_UNUSABLE = 2;

export interface AnchorCliIo {
  readonly argv: readonly string[];
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  /** Every manifest in the directory, in a stable order. Never a diff — that is the point. */
  readonly listManifests: (dir: string) => Promise<readonly string[]>;
  readonly deps: AnchorDeps;
}

/**
 * Asks of EVERY manifest, not only the ones a change touched: does each live
 * mutation's before-text still appear exactly once in its file, and does each
 * `-t` pattern still select a test?
 *
 * The diff-scoped question is the one `bin/verify-manifests` already asks, and
 * it is why a large batch of anchors across many manifests was once dead behind
 * a green gate: a lane that reformats a source file breaks anchors in manifests
 * its diff never names, and those manifests are never replayed again. Scoping
 * this check to a diff too would rebuild that hole, so it deliberately walks the
 * directory.
 */
export async function runAnchorCli(io: AnchorCliIo): Promise<number> {
  const dir = io.argv[0] ?? DEFAULT_MANIFEST_DIR;
  let manifests: readonly string[];
  try {
    manifests = await io.listManifests(dir);
  } catch (error) {
    io.logError(
      `anchors: cannot list ${dir}: ${error instanceof Error ? error.message : String(error)} — ` +
        `refusing to report that as nothing to check`,
    );
    return EXIT_UNUSABLE;
  }
  if (manifests.length === 0) {
    io.log(`anchors: no manifests in ${dir}; nothing to check`);
    return 0;
  }
  const report = await checkAnchors(manifests, io.deps);
  io.log(formatAnchorReport(report));
  return anchorExitCode(report);
}
