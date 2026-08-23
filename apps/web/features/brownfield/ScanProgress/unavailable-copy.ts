/**
 * The "this deployment does not run the GitHub scan endpoint" copy, kept in a
 * module of its own.
 *
 * WHY IT IS NOT IN `scan-stream.ts` ANY MORE: the tier picker (S1) has to state
 * whether Tier B is reachable, which means it needs this one string set — and
 * importing it from `scan-stream` made the FIRST screen of the flow depend on
 * the whole NDJSON streaming protocol (~800 lines of frame parsing and run
 * folding) to render three cards it may never scan with. Raised in review on
 * #619.
 *
 * The dependency was probably free in practice: `scan-stream` is pure functions
 * and const literals with no top-level side effects, which is the shape
 * bundlers tree-shake reliably. "Probably free" is a bad reason for a
 * presentational screen to reach into a transport module, and nobody had
 * measured it, so the coupling is removed rather than reasoned about.
 *
 * The `ScanFailureCopy` import below is TYPE-ONLY and therefore erased at
 * compile time: it creates no runtime edge back to `scan-stream`, so a consumer
 * of this module pulls in this module alone.
 */
import type { ScanFailureCopy } from "./scan-stream";

/**
 * The kill switch is OFF by default (`BROWNFIELD_GITHUB_SCAN`), and when it is
 * off the route answers 404 — the endpoint does not exist. "Not available" is
 * the truth; "something went wrong" is not, and neither is a retry button.
 *
 * Exported so the availability probe, the POST handler and the tier picker
 * produce the SAME copy: those are three ways of learning one fact, and they
 * must not disagree.
 */
export function describeUnavailable(): ScanFailureCopy {
  return {
    title: "Scanning a GitHub repository is not available here",
    detail:
      "This deployment does not run the GitHub scan endpoint, so there is nothing to connect to. It is switched off, not broken.",
    hint: "The other two import tiers work everywhere: upload the handoff zip from `npx hexagen scan --handoff`, or upload a zip of the repository.",
    code: "not-enabled",
  };
}
