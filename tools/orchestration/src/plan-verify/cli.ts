import { parsePremises } from "./lib/premises.js";
import { exitCodeFor, formatReport, verifyPremises } from "./lib/verify.js";
import type { Premise, VerifyDeps } from "../internal/premise-types.js";
import {
  PROVENANCE_UNKNOWN,
  buildArtifact,
  errorText,
  serializeArtifact,
  type ArtifactScope,
} from "../internal/artifact.js";

export interface PlanVerifyIo {
  /** Plan files to check. Empty means "every plan in `planDir`". */
  readonly argv: readonly string[];
  readonly log: (text: string) => void;
  readonly readFile: (path: string) => Promise<string>;
  /** Lists the plan directory. Only consulted when `argv` is empty. */
  readonly listPlanDir: () => Promise<readonly string[]>;
  readonly deps: VerifyDeps;
  readonly now: () => string;
  readonly git: (args: readonly string[]) => Promise<string>;
  readonly artifactPath: () => string;
  readonly writeArtifact: (path: string, contents: string) => Promise<void>;
  /**
   * The plan directory, as `config.yaml.planDir` records it. The source
   * hardcoded `docs/planning`; a packaged tool that assumes one project's
   * layout works on exactly one project (OW3's must-not, and OW-D4's single
   * source). Defaults to the source's own value so a direct caller keeps working.
   */
  readonly planDir?: string;
}

/** The fallback plan directory, matching the source's own constant. */
export const PLAN_DIR = "docs/planning";

export async function runCli(io: PlanVerifyIo): Promise<number> {
  let branch = PROVENANCE_UNKNOWN;
  let head = PROVENANCE_UNKNOWN;
  try {
    const b = (await io.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (b !== "") branch = b;
  } catch {
    // unknown
  }
  try {
    const h = (await io.git(["rev-parse", "HEAD"])).trim();
    if (h !== "") head = h;
  } catch {
    // unknown
  }

  const planDir = io.planDir ?? PLAN_DIR;
  const isSubset = io.argv.length > 0;
  const plans = isSubset
    ? [...io.argv]
    : (await io.listPlanDir())
        .filter((n) => n.endsWith(".md"))
        .sort()
        .map((n) => `${planDir}/${n}`);
  const premises: Premise[] = [];
  for (const plan of plans) {
    premises.push(...parsePremises(plan, await io.readFile(plan)));
  }
  const results = await verifyPremises(premises, io.deps);
  io.log(formatReport(results));

  const scope: ArtifactScope = isSubset
    ? { kind: "partial", plans }
    : { kind: "full" };
  const artifact = buildArtifact(results, {
    at: io.now(),
    git: { branch, head },
    scope,
    plans,
  });

  const path = io.artifactPath();
  try {
    await io.writeArtifact(path, serializeArtifact(artifact));
  } catch (err: unknown) {
    io.log(`WARN: could not write artifact ${path}: ${errorText(err)}`);
  }

  return exitCodeFor(results);
}
