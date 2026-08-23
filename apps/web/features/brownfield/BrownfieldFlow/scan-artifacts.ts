/**
 * The scan envelope -> the shapes S3–S7 need. PURE, and the answer to the one
 * question the ratification screens could not previously answer: where does
 * each screen's data come from?
 *
 * ## The gap this module closes
 *
 * `useLayoutRatify` takes `packages: DetectedPackageSummary[]`. Nothing in the
 * repository produced one — a grep for the type before this module existed
 * found the definition, three test fixtures, and no producer at all. Meanwhile
 * the scan envelope carries `layoutExcerpt`, the text of the `layout.yaml` that
 * `hexagen scan` (via `runAdopt`) just wrote. Those are the two ends of the same
 * wire and nobody had joined them, which is the mechanical reason S3 was
 * unreachable and therefore the reason `SCAN_COMPLETE` was never dispatched.
 *
 * ## Why the reading is PARSED here and not held as a third state
 *
 * The flow already carries the ratification drafts (`BrownfieldFlowViewState`
 * has `layoutDraft`, `manifestDraft`, `baselinedFindingKeys`). What it does not
 * carry is the SCAN — and it deliberately must not: BF-3.4's persistence policy
 * splits "recoverable user input" from "server state", and a scan is server
 * state describing a repository that may have moved on. So the scan lives in
 * the host's React state for the lifetime of the run, and this module is the
 * single place that projects it into what each screen consumes. Adding a global
 * store would move the same object further from the screen that reads it while
 * buying nothing: there is exactly one consumer, the flow host.
 *
 * ## The clip, and why a parse failure is a MESSAGE rather than an empty list
 *
 * `layoutExcerpt` is clipped to `MAX_SCAN_LAYOUT_EXCERPT_CHARS` and the clipper
 * appends `\n…`, so a large layout arrives as INVALID YAML. Returning `[]` for
 * that would put the user on a ratification screen stating "no packages were
 * detected" — a claim about their repository, made on the strength of a string
 * this module could not read. Every failure arm therefore carries a finished
 * sentence, and the caller renders it instead of a proposal. Same discipline as
 * `ScanFindings`: an unread list is not an empty one.
 */
import yaml from "js-yaml";

// Type-only, and that matters: `artifact-parse.ts` imports `node:fs/promises`,
// so a VALUE import would drag a server module into the client bundle. The type
// is erased at compile time. `BrownfieldImportPage` already imports it this way.
import type { ProjectHandoffResponse } from "@/lib/project-scan/artifact-parse";
import type { ProjectScanResponse } from "@/lib/project-scan/types";
import {
  readScanFindings,
  summarizeFindingsSource,
} from "../FindingsReview/baseline-draft";
import type { DetectedPackageSummary } from "../LayoutRatify/layout-draft";
import { LAYOUT_LAYERS } from "../LayoutRatify/layout-draft";
import type { BrownfieldLayoutDraft } from "./types";

/**
 * What the layout text turned out to be.
 *
 * `packages` and `problem` are NOT mutually exclusive: a layout can name six
 * usable contexts and one malformed entry, and dropping the note would hide a
 * package the user expected to see. A caller renders both.
 */
export interface DetectedLayoutReading {
  readonly packages: readonly DetectedPackageSummary[];
  /**
   * Finished, user-facing copy for what could not be read, or `null` when the
   * whole document was understood. Never a stack trace and never a bare
   * "invalid": it names what to do next, because on this screen the alternative
   * is the user believing their repository has no packages in it.
   */
  readonly problem: string | null;
}

const NO_LAYOUT: DetectedLayoutReading = {
  packages: [],
  problem:
    "The scan did not return a layout, so there are no detected packages to confirm. Nothing here describes your repository — run the scan again before ratifying anything.",
};

/**
 * The truncation marker `clip()` appends in `cli-hexagen-scan.adapter.ts` and
 * `artifact-parse.ts`. Checked BEFORE parsing so a clipped layout is reported
 * as clipped rather than as malformed — the two need different advice, and
 * "your layout.yaml is invalid" would be a lie about a file that is fine.
 */
const CLIP_MARKER = "\n…";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One `contexts:` entry -> a detected package, or `null` when the entry cannot
 * stand on its own.
 *
 * `root` is REQUIRED, deliberately. `ContextLayoutSchema` in
 * `tools/arch-linter/src/layout-config.ts` declares `root: z.string().min(1)`,
 * so an entry without one is a layout the linter itself rejects. The tempting
 * repair — fall back to the context name — invents a repo-relative path out of
 * a label, and the user would then ratify a mapping onto a directory that may
 * not exist. Skipping and SAYING SO is the only honest arm.
 */
function toDetectedPackage(
  name: string,
  entry: unknown,
): DetectedPackageSummary | null {
  if (!isRecord(entry)) return null;
  const root = entry.root;
  if (typeof root !== "string" || root.trim() === "") return null;

  const layers: Record<string, string[]> = {};
  const rawLayers = entry.layers;
  if (isRecord(rawLayers)) {
    for (const layer of LAYOUT_LAYERS) {
      const directories = rawLayers[layer];
      if (!Array.isArray(directories)) continue;
      const usable = directories.filter(
        (directory): directory is string =>
          typeof directory === "string" && directory.trim() !== "",
      );
      if (usable.length > 0) layers[layer] = usable;
    }
  }

  return { root: root.trim(), name: name.trim(), layers };
}

/**
 * Reads `layout.yaml` text into the package list S3 edits.
 *
 * `yaml.load` is js-yaml 4's DEFAULT schema, which has no custom types and no
 * code execution — the same call `features/code-view` and
 * `features/manifest-generation` already make on client-supplied YAML. The
 * input is additionally bounded before it ever gets here: both producers clip
 * it to `MAX_SCAN_LAYOUT_EXCERPT_CHARS`.
 */
export function readDetectedPackages(
  layoutText: string | null | undefined,
): DetectedLayoutReading {
  if (typeof layoutText !== "string" || layoutText.trim() === "") {
    return NO_LAYOUT;
  }

  if (layoutText.endsWith(CLIP_MARKER)) {
    return {
      packages: [],
      problem:
        "The layout this scan returned was too large to send whole, so it arrived truncated and cannot be read as a package list. Your layout.yaml is fine — it is the transfer that clipped it. Ratify the layout with the `hexagen` CLI in your repository instead.",
    };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(layoutText);
  } catch {
    return {
      packages: [],
      problem:
        "The layout this scan returned could not be read as YAML, so no packages can be listed. That is a problem with the scan output rather than with your repository — run the scan again.",
    };
  }

  if (!isRecord(parsed)) {
    return {
      packages: [],
      problem:
        "The layout this scan returned is not a YAML mapping, so it names no contexts. Run the scan again before ratifying anything.",
    };
  }

  const contexts = parsed.contexts;

  if (typeof contexts === "string") {
    // The glob dialect (`contexts: "packages/*"`). It is a valid layout, but it
    // names a PATTERN rather than packages, so there is nothing to enumerate
    // here and pretending otherwise would show an empty grid.
    return {
      packages: [],
      problem: `This layout uses the pattern form (\`contexts: ${contexts}\`) rather than an explicit list, so there are no individual packages to confirm on this screen. It is already a valid layout — ratifying it again would only narrow it.`,
    };
  }

  if (!isRecord(contexts)) {
    return {
      packages: [],
      problem:
        "The layout this scan returned has no `contexts:` block, so no packages were detected. `hexagen scan` writes one; a layout without it did not come from a completed scan.",
    };
  }

  const packages: DetectedPackageSummary[] = [];
  const skipped: string[] = [];
  for (const [name, entry] of Object.entries(contexts)) {
    const detected = toDetectedPackage(name, entry);
    if (detected === null) {
      skipped.push(name);
      continue;
    }
    packages.push(detected);
  }

  if (packages.length === 0 && skipped.length === 0) {
    return {
      packages: [],
      problem:
        "The scan found no workspace packages. There is nothing to map onto bounded contexts, so the layout cannot be ratified from here.",
    };
  }

  return {
    packages,
    problem:
      skipped.length === 0
        ? null
        : `${skipped.length === 1 ? "One context" : `${skipped.length} contexts`} in the returned layout (${skipped.join(", ")}) name no \`root:\` directory, so ${skipped.length === 1 ? "it is" : "they are"} not shown below. A context without a root is a layout the linter rejects — fix it in your repository rather than here.`,
  };
}

/**
 * Rebuild a package list from a draft the user already ratified.
 *
 * This is what makes BF-3.4's resume contract true rather than aspirational.
 * `resolveResumeState` lists `layout_ratify` as resumable on the grounds that
 * its screen "renders ENTIRELY from persisted input" — but the persisted draft
 * is a `BrownfieldLayoutDraft`, and `useLayoutRatify` renders `packages`, which
 * is server state and is deliberately NOT persisted. Without this projection a
 * restored S3 renders an EMPTY grid: `mergeRatifiedDraft` maps over rows, and
 * there are no rows to map.
 *
 * KNOWN AND DELIBERATE LOSS: the rebuilt packages carry the RATIFIED values as
 * their "detected" values, because what the detector originally proposed was
 * never persisted. So a resumed screen shows no "edited" badges and its "Reset
 * to detected" restores what the user confirmed rather than what was found.
 * Every value on screen is still something the user personally confirmed, which
 * is the property that matters; the alternative — refusing to resume at all —
 * would throw the ratification away to preserve a badge.
 */
export function packagesFromLayoutDraft(
  draft: BrownfieldLayoutDraft | null | undefined,
): readonly DetectedPackageSummary[] {
  if (!draft || !Array.isArray(draft.contexts)) return [];
  return draft.contexts.map((context) => ({
    root: context.packageRoot,
    name: context.contextName,
    layers: { ...context.layerDirectories },
  }));
}

/**
 * A Tier-A handoff, in the shape S6 reads.
 *
 * `ProjectHandoffResponse` is documented as structurally consistent with
 * `ProjectScanResponse` "for every shared field" — but not for `verdict`, whose
 * two values (`ingested` / `incomplete`) describe THE UPLOAD rather than the
 * codebase. The mapping is therefore the one judgement in this module, and it is
 * made conservatively:
 *
 *  - `incomplete` -> `could-not-run`. The upload carried no report, so nothing
 *    in it says anything about the tree.
 *  - `ingested` -> `pass`. This looks like the risky direction and is not, and
 *    the reason is worth stating because it is load-bearing: a handoff carries
 *    NO `findings` field at all (`artifacts.suppressions` is the baseline
 *    ledger, not a fresh lint run), so `describeScanOutcome` classifies it as
 *    `unreadable` — "this scan reported no findings list at all… that is not
 *    the same as a clean tree" — BEFORE any verdict-driven branch runs. The
 *    outcome is untrustworthy, the count pills are suppressed and the gate
 *    installer is blocked with a stated reason. Mapping to `violations` instead
 *    would print the identical screen while additionally being a claim nothing
 *    measured.
 */
export function scanFromHandoff(
  handoff: ProjectHandoffResponse,
): ProjectScanResponse {
  return {
    verdict: handoff.verdict === "incomplete" ? "could-not-run" : "pass",
    exitCode: null,
    projectName: handoff.projectName,
    layoutExcerpt: handoff.layoutExcerpt,
    filesScanned: null,
    reportMarkdown: handoff.reportMarkdown,
    errorMessage:
      handoff.errorMessage ??
      (handoff.verdict === "incomplete"
        ? "The uploaded handoff contained no report, so nothing was read about the codebase."
        : null),
    // Absent, not empty. See the docblock: a handoff has no findings list, and
    // `readScanFindings(undefined)` is the `not-reported` arm by design.
    findings: null,
  };
}

/**
 * "We do not know how many findings are fresh."
 *
 * NEGATIVE ON PURPOSE, and the state machine's own comment is the specification:
 * `RATIFY_MANIFEST` skips `findings_review` on an explicit `0` and the comment
 * spells out that a `> 0` test would be wrong precisely because it would also
 * skip on a negative or NaN count. So an unknown count must be a value that is
 * neither zero nor a plausible tally, and it must route the user TO the review
 * screen — where `deriveBlockingReason` states that an unread list is not an
 * empty one and refuses to ratify. Passing `0` here is the false green the whole
 * `ScanFindings` contract exists to prevent.
 */
export const UNKNOWN_FRESH_FINDING_COUNT = -1;

/**
 * How many findings are failing the gate, or {@link UNKNOWN_FRESH_FINDING_COUNT}
 * when the scan did not report a findings list at all.
 *
 * Counted through `summarizeFindingsSource` rather than off `findings.fresh`
 * directly, so this number is the same number S5 and S6 display — it dedupes by
 * `findingKey` exactly as the grid does.
 */
export function freshFindingCountOf(
  scan: Pick<ProjectScanResponse, "findings">,
): number {
  const counts = summarizeFindingsSource(readScanFindings(scan.findings));
  return counts === null ? UNKNOWN_FRESH_FINDING_COUNT : counts.fresh;
}

/**
 * A correlation id for one run, in the alphabet the install-gate route accepts.
 *
 * `/api/projects/install-gate` validates `scanId` against
 * `/^[A-Za-z0-9._-]{1,64}$/` and echoes it into the download filename; it is a
 * NAME, not a lookup key (the route's own docblock says no `ScanRecord` store
 * exists to look one up in). Deriving it from the project name means the file
 * the consultant hands to their client is called after the project rather than
 * after a UUID, and the suffix keeps two runs of the same project distinct.
 *
 * Every character outside the allow-list collapses to `-`, so the result is
 * accepted by construction rather than by hope.
 */
export function deriveScanId(projectName: string, suffix: string): string {
  const slug = projectName
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const tail = suffix.replace(/[^A-Za-z0-9._-]+/g, "").slice(0, 20);
  const joined = slug === "" ? `scan-${tail}` : `${slug}-${tail}`;
  // A suffix of only illegal characters would leave a trailing "-"; and an
  // empty name with an empty suffix would leave "scan-". Neither can be
  // allowed to produce a value the route then 400s on.
  const trimmed = joined.replace(/-+$/g, "").slice(0, 64);
  return trimmed === "" ? "scan" : trimmed;
}
