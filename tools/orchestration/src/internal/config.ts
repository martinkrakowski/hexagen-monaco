import { load as parseYaml } from "js-yaml";
import {
  parseLaneHosts,
  type LaneHost,
  type LaneHostGate,
  type Seat,
} from "./lane-hosts.js";

/**
 * The consumer overlay's configuration — the ONE source for everything the
 * package needs to know about a project (OW-D4, OW-D7 as amended by §12 A-15,
 * A-20, A-21, A-22, A-30 and A-32).
 *
 * Nothing in this package hardcodes a repository, a port, a log root or a gate
 * step. A bin that needed one of those and could not find it here would be a
 * bin that worked on the machine it was written on and nowhere else.
 *
 * The loader is deliberately two-layered, because `doctor` needs both halves:
 *
 * - `parseConfig` validates the file's SHAPE (the 17 fields, their types, the
 *   closed `invariants` set, the `overrides[]` contract) and applies every
 *   default. It is total: it returns its `config` ALONGSIDE its problems. A field
 *   that failed validation holds its default in that config; `config` is absent
 *   only for a whole-file fault (not YAML, not a mapping).
 * - `loadConfig` adds the one thing that needs the outside world — `repo`,
 *   derived from `gh` when the file omits it — and the one thing that needs a
 *   filesystem — whether the file was there at all.
 *
 * THE CONTRACT for a bin: `loadConfigFor` always returns a `config`, but when the
 * file is present and has problems that config cannot be trusted. A bin that
 * ACTS on it must refuse: exit 2, print every problem, write nothing (see
 * `refusal.ts`). Only a diagnostic bin (`doctor`) prints the problems and keeps
 * going.
 *
 * A field that is absent takes its documented default. A field that is PRESENT
 * and wrong is an error: a gate that quietly substitutes a default for a
 * misspelled value is a gate that passes without running what was asked.
 *
 * A third channel sits next to `problems`: `deprecations` (A-30). A deprecation
 * is a setting that still works and should no longer be written — today
 * `opencodeServerUrl`, which is synthesized into a local `laneHosts` entry. A
 * deprecation NEVER refuses: `configRefusal` ignores it, and `doctor` prints it
 * as a WARN.
 */

export type { LaneHost, LaneHostGate, Seat };

/** Where the overlay lives, relative to the repository root. */
export const CONFIG_RELATIVE_PATH = ".agents/orchestration/config.yaml";

/** The `invariants` this package locks, and the only values each may hold. */
export const LOCKED_INVARIANTS = {
  statusSource: "derived",
  eventDuty: true,
  mergeRequiresGreenGate: true,
  attribution: false,
} as const;

export type InvariantName = keyof typeof LOCKED_INVARIANTS;

export const INVARIANT_NAMES: readonly InvariantName[] = Object.keys(
  LOCKED_INVARIANTS,
) as InvariantName[];

/** The one gate step, in the order it runs. `optional` may skip; see OW3 §12 A-21. */
export interface GateStep {
  readonly name: string;
  readonly command: string;
  readonly optional?: boolean;
  /** Runs under the machine-wide gate lock. Only `locked: true` marks a step locked. */
  readonly locked?: boolean;
}

/** A project that has deliberately departed from a locked invariant, and why. */
export interface ConfigOverride {
  readonly invariant: string;
  readonly reason: string;
}

/** The project-facing settings, after defaults have been applied. */
export interface Config {
  readonly planDir: string;
  readonly gateSteps: readonly GateStep[];
  readonly requiredCheck: string;
  /**
   * Absent when unset. NEVER `""`: `new RegExp("")` matches every path, so an
   * empty default would make the whole tree append-only. Consumers go through
   * `matchesAppendOnly`, which treats absent as "matches nothing".
   */
  readonly appendOnlyPaths?: string;
  readonly forbiddenPorts: readonly number[];
  readonly operatorDataPaths: readonly string[];
  /**
   * Where a delegated lane dispatches, and how. Empty when the project declares
   * none, which is not a problem: a project that dispatches nowhere is a project
   * with no lane hosts (A-30).
   */
  readonly laneHosts: readonly LaneHost[];
  /**
   * The opencode-dispatched seats, each naming a `laneHosts[].name`. Empty is
   * legal, and `doctor` then WARNs for every host no seat references — the
   * dispatch identity is missing, not the host (A-30).
   */
  readonly seats: readonly Seat[];
  /** Absent when unset — `logdir.ts` then derives `$HOME/.waves-<name>`. */
  readonly waveLogDir?: string;
  readonly coverageRequirement?: number;
  readonly mutate: boolean;
  /** Absent when unset — `wave-status` then serves its neutral token set. */
  readonly tokensCssPath?: string;
  readonly overrides: readonly ConfigOverride[];
  readonly invariants: { readonly [K in InvariantName]: unknown };
  /** `owner/name`, or absent when neither the file nor `gh` could supply it. */
  readonly repo?: string;
  readonly waveStatusPort: number;
  /**
   * Repository-relative path of the CI workflow `doctor` requires (A-32).
   * Default `.github/workflows/ci.yml`; `init` never writes it.
   */
  readonly ciWorkflow: string;
}

/** One thing wrong with the file, phrased so an operator can act on it. */
export interface ConfigProblem {
  /** The YAML path, e.g. `overrides[0].reason`, or `<file>` for a whole-file fault. */
  readonly at: string;
  readonly message: string;
}

/**
 * A setting that still parses and should no longer be written (A-30 §1.3).
 *
 * Same shape as a problem, different channel, and never the same consequence:
 * `configRefusal` does not see it and `doctor` reports it as a WARN. Carrying it
 * as a problem would break every overlay that has not migrated yet, for the sake
 * of a migration no one asked to be broken.
 */
export type ConfigDeprecation = ConfigProblem;

export interface ParseConfigResult {
  /**
   * Absent only for a whole-file fault (not YAML, not a mapping). Otherwise
   * present even when `problems` is not empty: fields that failed validation
   * hold their defaults and the rest hold what the file said.
   */
  readonly config?: Config;
  readonly problems: readonly ConfigProblem[];
  /** Never refuses. Reported by `doctor` as a WARN. */
  readonly deprecations: readonly ConfigDeprecation[];
}

/** `gh repo view --json nameWithOwner`, and whatever else a caller needs to ask. */
export interface ConfigIo {
  /** The raw file text, or `undefined` when there is no config file at all. */
  readonly readConfig: () => Promise<string | undefined>;
  /** `owner/name` for the repository, or `undefined` when it cannot be determined. */
  readonly repo: () => Promise<string | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** `owner/name` — one slash, with a non-empty half on each side. */
const REPO_PATTERN = /^[^\s/]+\/[^\s/]+$/;

class Problems {
  readonly list: ConfigProblem[] = [];

  add(at: string, message: string): void {
    this.list.push({ at, message });
  }
}

/**
 * `overrides[]` as written, without judging it. Kept raw because `doctor`
 * reports a malformed entry and `parseConfig` reports a missing reason, and
 * both want the entry that was actually written.
 */
export function readOverrides(raw: unknown): readonly unknown[] {
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [];
}

function parseOverrides(raw: unknown, problems: Problems): ConfigOverride[] {
  // `readOverrides` reads a non-list as "no entries", which is right for the
  // caller that only wants the raw list and wrong here: a mapping where a list
  // belongs is a project that WROTE overrides, and dropping them silently turns
  // its declared exceptions into locked-invariant violations (or worse, none).
  if (raw !== undefined && !Array.isArray(raw)) {
    problems.add(
      "overrides",
      "must be a list of { invariant, reason } entries",
    );
    return [];
  }
  const entries = readOverrides(raw);
  const parsed: ConfigOverride[] = [];
  entries.forEach((entry, i) => {
    if (!isRecord(entry)) {
      problems.add(
        `overrides[${i}]`,
        "must be a mapping with `invariant` and `reason`",
      );
      return;
    }
    const reason = entry.reason;
    if (reason === undefined) {
      problems.add(
        `overrides[${i}].reason`,
        "is required: an override that changes a locked invariant must say why",
      );
      return;
    }
    if (!isNonEmptyString(reason)) {
      problems.add(
        `overrides[${i}].reason`,
        "must be a non-empty string: an override that changes a locked invariant must say why",
      );
      return;
    }
    const invariant = entry.invariant;
    if (!isNonEmptyString(invariant)) {
      problems.add(
        `overrides[${i}].invariant`,
        `must name one of: ${INVARIANT_NAMES.join(", ")}`,
      );
      return;
    }
    // An override naming something that is not a locked invariant overrides
    // nothing, and reads as if it did. That is the same silence the whole
    // `overrides` mechanism exists to end, one level up.
    if (!INVARIANT_NAMES.includes(invariant as InvariantName)) {
      problems.add(
        `overrides[${i}].invariant`,
        `${JSON.stringify(invariant)} is not one of: ${INVARIANT_NAMES.join(", ")}`,
      );
      return;
    }
    parsed.push({ invariant, reason });
  });
  return parsed;
}

/**
 * `invariants`, defaulted then checked key by key against the locked set.
 *
 * A key that DIFFERS from its locked default is not rejected outright — an
 * `overrides[]` entry naming it is exactly the sanctioned way to say so. What
 * is rejected is a difference with no such entry, because that is an invariant
 * that was changed by accident and then never explained. This is `doctor`'s
 * one job that the loader has to share with it, since the check is over the
 * resolved object.
 */
export function parseInvariants(
  raw: unknown,
  overrides: readonly ConfigOverride[],
  problems: Problems,
): Config["invariants"] {
  const resolved: Record<InvariantName, unknown> = { ...LOCKED_INVARIANTS };
  if (raw !== undefined) {
    if (!isRecord(raw)) {
      problems.add("invariants", "must be a mapping");
      return resolved;
    }
    for (const [key, value] of Object.entries(raw)) {
      if (!INVARIANT_NAMES.includes(key as InvariantName)) {
        problems.add(
          `invariants.${key}`,
          `is not one of: ${INVARIANT_NAMES.join(", ")}`,
        );
        continue;
      }
      resolved[key as InvariantName] = value;
    }
  }

  for (const name of INVARIANT_NAMES) {
    if (resolved[name] === LOCKED_INVARIANTS[name]) continue;
    const covered = overrides.some((entry) => entry.invariant === name);
    if (!covered) {
      problems.add(
        `invariants.${name}`,
        `differs from its locked default ` +
          `(${JSON.stringify(LOCKED_INVARIANTS[name])}) with no overrides[] entry naming it`,
      );
    }
  }
  return resolved;
}

function parseStringArray(
  raw: unknown,
  at: string,
  fallback: readonly string[],
  problems: Problems,
): string[] {
  if (raw === undefined) return [...fallback];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    problems.add(at, "must be a list of strings");
    return [...fallback];
  }
  return raw as string[];
}

function parseNumberArray(
  raw: unknown,
  at: string,
  fallback: readonly number[],
  problems: Problems,
): number[] {
  if (raw === undefined) return [...fallback];
  if (
    !Array.isArray(raw) ||
    raw.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    problems.add(at, "must be a list of numbers");
    return [...fallback];
  }
  return raw as number[];
}

function parseGateSteps(raw: unknown, problems: Problems): GateStep[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.add("gateSteps", "must be a list of steps");
    return [];
  }
  const steps: GateStep[] = [];
  raw.forEach((entry, i) => {
    if (!isRecord(entry)) {
      problems.add(
        `gateSteps[${i}]`,
        "must be a mapping with `name` and `command`",
      );
      return;
    }
    if (!isNonEmptyString(entry.name)) {
      problems.add(`gateSteps[${i}].name`, "must be a non-empty string");
      return;
    }
    if (!isNonEmptyString(entry.command)) {
      problems.add(`gateSteps[${i}].command`, "must be a non-empty string");
      return;
    }
    // Only a literal `true` marks a step optional. `no`, `null`, `"false"` are
    // not booleans, and reading any of them as "optional" would let a step the
    // author meant to require be skipped: the gate would pass without running it.
    if (entry.optional !== undefined && typeof entry.optional !== "boolean") {
      problems.add(
        `gateSteps[${i}].optional`,
        `must be true or false. Read ${JSON.stringify(entry.optional)}; only \`optional: true\` lets a step skip`,
      );
    }
    // Same rule for `locked`: which steps hold the machine-wide lock is the
    // project's to say (it was a hardcoded list of campaign-foundry step names),
    // and reading a non-boolean as "locked" or "not locked" would silently run a
    // step with, or without, the mutual exclusion its author asked for.
    if (entry.locked !== undefined && typeof entry.locked !== "boolean") {
      problems.add(
        `gateSteps[${i}].locked`,
        `must be true or false. Read ${JSON.stringify(entry.locked)}; only \`locked: true\` runs a step under the gate lock`,
      );
    }
    steps.push({
      name: entry.name,
      command: entry.command,
      ...(entry.optional === true ? { optional: true } : {}),
      ...(entry.locked === true ? { locked: true } : {}),
    });
  });
  return steps;
}

/** Whether `text` is an absolute http(s) URL. `host:port` parses as a scheme, so it is not. */
function isHttpUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Whether an http(s) URL carries a query or a fragment. The text is checked as
 * well as the parsed parts, because `http://h/?` and `http://h/#` parse to an
 * EMPTY search and hash, and appending `/doc` to either still lands inside them.
 */
function hasQueryOrFragment(text: string): boolean {
  const { search, hash } = new URL(text);
  return (
    search !== "" || hash !== "" || text.includes("?") || text.includes("#")
  );
}

function parseOptionalString(
  raw: unknown,
  at: string,
  problems: Problems,
): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    problems.add(at, "must be a string");
    return undefined;
  }
  return raw;
}

function parseOptionalNumber(
  raw: unknown,
  at: string,
  problems: Problems,
): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    problems.add(at, "must be a number");
    return undefined;
  }
  return raw;
}

/**
 * Validate a config file's text and apply every default.
 *
 * `repo` is left absent here even when the file set it to something malformed:
 * resolving it needs `gh`, which is `loadConfig`'s job. A `repo` that is
 * present but not `owner/name` is still reported, because a project whose repo
 * is misspelled must not resolve to a directory named after the typo.
 */
export function parseConfig(text: string): ParseConfigResult {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (err) {
    return {
      problems: [
        {
          at: "<file>",
          message: `is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      deprecations: [],
    };
  }

  if (document === null || document === undefined) {
    return { config: emptyConfig(), problems: [], deprecations: [] };
  }
  if (!isRecord(document)) {
    return {
      problems: [{ at: "<file>", message: "must be a mapping of settings" }],
      deprecations: [],
    };
  }

  const problems = new Problems();

  // OW-D7 calls this list exhaustive, and `doctor` refuses an unknown key.
  // `cast` was in an earlier draft of the list and is NOT one of the seventeen;
  // it is named separately only so the message says so. `opencodeServerUrl` is
  // in `KNOWN_FIELDS` as a DEPRECATED ALIAS (A-30): it is accepted, synthesized
  // into a local lane host and deprecation-reported, but it is not a field.
  for (const key of Object.keys(document)) {
    if (key === "cast") {
      problems.add(
        "cast",
        "is not a setting of this overlay. The cast lives in .agents/orchestration/cast.md",
      );
      continue;
    }
    if (KNOWN_FIELDS.has(key)) continue;
    problems.add(
      key,
      `is not a known setting. Known settings: ${[...KNOWN_FIELDS].join(", ")}`,
    );
  }

  const overrides = parseOverrides(document.overrides, problems);
  const invariants = parseInvariants(document.invariants, overrides, problems);

  const planDir =
    parseOptionalString(document.planDir, "planDir", problems) ??
    "docs/planning";
  const requiredCheck =
    parseOptionalString(document.requiredCheck, "requiredCheck", problems) ??
    "^Build";
  let appendOnlyPaths = parseOptionalString(
    document.appendOnlyPaths,
    "appendOnlyPaths",
    problems,
  );
  // Compile it NOW. A pattern that is a string but not a regex would otherwise
  // parse clean, pass `doctor`, and throw a SyntaxError from the first
  // `matchesAppendOnly` call, in the middle of a gate. The field is left off the
  // config so nothing downstream can trip on it.
  if (appendOnlyPaths !== undefined) {
    try {
      new RegExp(appendOnlyPaths);
    } catch (err) {
      problems.add(
        "appendOnlyPaths",
        `must be a valid regular expression: ${err instanceof Error ? err.message : String(err)}`,
      );
      appendOnlyPaths = undefined;
    }
  }
  // A-20: refused ports come ONLY from the file. The default is empty, because
  // 4317 is campaign-foundry's port and refusing it here would refuse a
  // project that legitimately wants it (A-20).
  const forbiddenPorts = parseNumberArray(
    document.forbiddenPorts,
    "forbiddenPorts",
    [],
    problems,
  );
  const operatorDataPaths = parseStringArray(
    document.operatorDataPaths,
    "operatorDataPaths",
    [],
    problems,
  );
  const rawServerUrl = parseOptionalString(
    document.opencodeServerUrl,
    "opencodeServerUrl",
    problems,
  );
  // A deprecated alias still has to be a URL the synthesized host can dispatch
  // to and curl: `""` and `127.0.0.1:4096` would synthesize a host that fails
  // on its first lane instead of at the file.
  let opencodeServerUrl: string | undefined;
  if (rawServerUrl !== undefined) {
    if (isHttpUrl(rawServerUrl) && hasQueryOrFragment(rawServerUrl)) {
      // The synthesized check appends `/doc`, which would land INSIDE a query or
      // a fragment and probe a URL nobody wrote.
      problems.add(
        "opencodeServerUrl",
        `must not carry a query (\`?\`) or a fragment (\`#\`): the synthesized check appends /doc to it. Read ${JSON.stringify(rawServerUrl)}`,
      );
    } else if (isHttpUrl(rawServerUrl)) {
      opencodeServerUrl = rawServerUrl;
    } else {
      problems.add(
        "opencodeServerUrl",
        `must be an http(s) URL, such as http://127.0.0.1:4096. Read ${JSON.stringify(rawServerUrl)}`,
      );
    }
  }
  const laneHostFields = parseLaneHosts(
    document.laneHosts,
    document.seats,
    opencodeServerUrl,
  );
  for (const problem of laneHostFields.problems) {
    problems.add(problem.at, problem.message);
  }
  const waveLogDir = parseOptionalString(
    document.waveLogDir,
    "waveLogDir",
    problems,
  );
  const coverageRequirement = parseOptionalNumber(
    document.coverageRequirement,
    "coverageRequirement",
    problems,
  );
  const tokensCssPath = parseOptionalString(
    document.tokensCssPath,
    "tokensCssPath",
    problems,
  );

  let mutate = false;
  if (document.mutate !== undefined) {
    if (typeof document.mutate !== "boolean") {
      problems.add("mutate", "must be true or false");
    } else {
      mutate = document.mutate;
    }
  }

  const gateSteps = parseGateSteps(document.gateSteps, problems);

  let waveStatusPort = DEFAULT_WAVE_STATUS_PORT;
  if (document.waveStatusPort !== undefined) {
    const port = parseOptionalNumber(
      document.waveStatusPort,
      "waveStatusPort",
      problems,
    );
    if (port !== undefined) waveStatusPort = port;
  }

  // A-32: a repository-relative path. A rule, not a coercion: an absolute path or
  // a `..` segment would point doctor's existence probe outside the project.
  let ciWorkflow = DEFAULT_CI_WORKFLOW;
  const rawCiWorkflow = parseOptionalString(
    document.ciWorkflow,
    "ciWorkflow",
    problems,
  );
  if (rawCiWorkflow !== undefined) {
    if (
      !isNonEmptyString(rawCiWorkflow) ||
      rawCiWorkflow.startsWith("/") ||
      rawCiWorkflow.startsWith("\\") ||
      /^[A-Za-z]:/.test(rawCiWorkflow) ||
      rawCiWorkflow.includes("\0") ||
      rawCiWorkflow.split(/[\\/]/).includes("..")
    ) {
      problems.add(
        "ciWorkflow",
        `must be a non-empty repository-relative path: not absolute, with no \`..\` segment and no NUL. Read ${JSON.stringify(rawCiWorkflow)}`,
      );
    } else {
      ciWorkflow = rawCiWorkflow;
    }
  }

  let repo: string | undefined;
  if (document.repo !== undefined) {
    if (!isNonEmptyString(document.repo)) {
      problems.add("repo", "must be a non-empty string of the form owner/name");
    } else if (!REPO_PATTERN.test(document.repo)) {
      problems.add(
        "repo",
        `must be of the form owner/name, as \`gh repo view --json nameWithOwner\` reports it. Read ${JSON.stringify(document.repo)}`,
      );
    } else {
      repo = document.repo;
    }
  }

  const config: Config = {
    planDir,
    gateSteps,
    requiredCheck,
    ...(appendOnlyPaths !== undefined ? { appendOnlyPaths } : {}),
    forbiddenPorts,
    operatorDataPaths,
    laneHosts: laneHostFields.hosts,
    seats: laneHostFields.seats,
    ...(waveLogDir !== undefined ? { waveLogDir } : {}),
    ...(coverageRequirement !== undefined ? { coverageRequirement } : {}),
    mutate,
    ...(tokensCssPath !== undefined ? { tokensCssPath } : {}),
    overrides,
    invariants,
    ...(repo !== undefined ? { repo } : {}),
    waveStatusPort,
    ciWorkflow,
  };

  // The config comes back WITH its problems. A field that failed validation is
  // at its default, but every field that was fine holds what the file said, so
  // `doctor` can go on to check the ports and the lane hosts the file actually
  // names instead of the defaults, and report every failure in one run.
  return {
    config,
    problems: problems.list,
    deprecations: laneHostFields.deprecations,
  };
}

/** The whole-file-absent case: every field at its default, and no `repo`. */
export function emptyConfig(): Config {
  return {
    planDir: "docs/planning",
    gateSteps: [],
    requiredCheck: "^Build",
    forbiddenPorts: [],
    operatorDataPaths: [],
    laneHosts: [],
    seats: [],
    mutate: false,
    overrides: [],
    invariants: { ...LOCKED_INVARIANTS },
    waveStatusPort: DEFAULT_WAVE_STATUS_PORT,
    ciWorkflow: DEFAULT_CI_WORKFLOW,
  };
}

/**
 * Whether `path` is an append-only path. An unset `appendOnlyPaths` matches
 * NOTHING (and an empty one is treated the same, rather than as the regex that
 * matches everything), so the append-only check is skipped, not universal.
 */
export function matchesAppendOnly(config: Config, path: string): boolean {
  const pattern = config.appendOnlyPaths;
  if (pattern === undefined || pattern === "") return false;
  return new RegExp(pattern).test(path);
}

/** The default `ciWorkflow` (A-32). */
export const DEFAULT_CI_WORKFLOW = ".github/workflows/ci.yml";

/** The default `waveStatusPort` — 4318, deliberately not campaign-foundry's 4317. */
export const DEFAULT_WAVE_STATUS_PORT = 4318;

const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  "planDir",
  "gateSteps",
  "requiredCheck",
  "appendOnlyPaths",
  "forbiddenPorts",
  "operatorDataPaths",
  "laneHosts",
  "seats",
  // A-30: accepted as a DEPRECATED ALIAS, and not one of the seventeen fields.
  "opencodeServerUrl",
  "waveLogDir",
  "coverageRequirement",
  "mutate",
  "tokensCssPath",
  "overrides",
  "invariants",
  "repo",
  "waveStatusPort",
  "ciWorkflow",
]);

/** `gh` answered, but not with an `owner/name`. Never assigned, always reported. */
function ghRepoProblem(repo: string): ConfigProblem {
  return {
    at: "repo",
    message: `\`gh\` reported ${JSON.stringify(repo)}, which is not owner/name`,
  };
}

/**
 * Load the overlay config for a project, deriving `repo` from `gh` when the
 * file omits it (OW-D7: `repo` defaults to `gh repo view --json nameWithOwner`).
 *
 * An ABSENT file is not an error: the loader returns every default, and `doctor`
 * is the thing that decides whether a project with no overlay is a problem. The
 * brief's per-field defaults are the same ones that apply to a whole absent
 * file, except that `repo` then needs `gh`.
 *
 * `deprecations` is carried on EVERY path, for the same reason `problems` is:
 * a result that rebuilt itself to add `repo` must not drop what the file asked
 * for. Losing a deprecation loses the one warning an unmigrated overlay gets.
 */
export async function loadConfig(io: ConfigIo): Promise<ParseConfigResult> {
  const text = await io.readConfig();
  if (text === undefined) {
    const repo = await io.repo();
    if (repo !== undefined && !REPO_PATTERN.test(repo)) {
      return {
        config: emptyConfig(),
        problems: [ghRepoProblem(repo)],
        deprecations: [],
      };
    }
    return {
      config: { ...emptyConfig(), ...(repo !== undefined ? { repo } : {}) },
      problems: [],
      deprecations: [],
    };
  }

  const parsed = parseConfig(text);
  if (parsed.config === undefined) return parsed;
  if (parsed.config.repo !== undefined) return parsed;
  // A `repo` the file wrote but got wrong is already a problem. Filling it in
  // from `gh` would hide the typo behind a value nobody wrote.
  if (parsed.problems.some((problem) => problem.at === "repo")) return parsed;

  const repo = await io.repo();
  if (repo === undefined) return parsed;
  if (!REPO_PATTERN.test(repo)) {
    return {
      config: parsed.config,
      problems: [...parsed.problems, ghRepoProblem(repo)],
      deprecations: parsed.deprecations,
    };
  }
  return {
    config: { ...parsed.config, repo },
    problems: parsed.problems,
    deprecations: parsed.deprecations,
  };
}
