import { load as parseYaml } from "js-yaml";

/**
 * The consumer overlay's configuration — the ONE source for everything the
 * package needs to know about a project (OW-D4, OW-D7 as amended by §12 A-15,
 * A-20, A-21 and A-22).
 *
 * Nothing in this package hardcodes a repository, a port, a log root or a gate
 * step. A bin that needed one of those and could not find it here would be a
 * bin that worked on the machine it was written on and nowhere else.
 *
 * The loader is deliberately two-layered, because `doctor` needs both halves:
 *
 * - `parseConfig` validates the file's SHAPE (the 15 fields, their types, the
 *   closed `invariants` set, the `overrides[]` contract) and applies every
 *   default. It is total: it returns a `Config`, or a list of problems.
 * - `loadConfig` adds the one thing that needs the outside world — `repo`,
 *   derived from `gh` when the file omits it — and the one thing that needs a
 *   filesystem — whether the file was there at all.
 *
 * A field that is absent takes its documented default. A field that is PRESENT
 * and wrong is an error: a gate that quietly substitutes a default for a
 * misspelled value is a gate that passes without running what was asked.
 */

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
  readonly appendOnlyPaths: string;
  readonly forbiddenPorts: readonly number[];
  readonly operatorDataPaths: readonly string[];
  /** Absent when the file omits it and `gh` could not answer; `doctor` fails. */
  readonly opencodeServerUrl?: string;
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
}

/** One thing wrong with the file, phrased so an operator can act on it. */
export interface ConfigProblem {
  /** The YAML path, e.g. `overrides[0].reason`, or `<file>` for a whole-file fault. */
  readonly at: string;
  readonly message: string;
}

export interface ParseConfigResult {
  readonly config?: Config;
  readonly problems: readonly ConfigProblem[];
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
    steps.push({
      name: entry.name,
      command: entry.command,
      ...(entry.optional !== undefined
        ? { optional: entry.optional !== false }
        : {}),
    });
  });
  return steps;
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
    };
  }

  if (document === null || document === undefined) {
    return { config: emptyConfig(), problems: [] };
  }
  if (!isRecord(document)) {
    return {
      problems: [{ at: "<file>", message: "must be a mapping of settings" }],
    };
  }

  const problems = new Problems();

  // OW-D7 calls this list exhaustive, and `doctor` refuses an unknown key.
  // `cast` was in an earlier draft of the list and is NOT one of the fifteen;
  // it is named separately only so the message says so.
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
  const appendOnlyPaths =
    parseOptionalString(
      document.appendOnlyPaths,
      "appendOnlyPaths",
      problems,
    ) ?? "";
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
  const opencodeServerUrl = parseOptionalString(
    document.opencodeServerUrl,
    "opencodeServerUrl",
    problems,
  );
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
    appendOnlyPaths,
    forbiddenPorts,
    operatorDataPaths,
    ...(opencodeServerUrl !== undefined ? { opencodeServerUrl } : {}),
    ...(waveLogDir !== undefined ? { waveLogDir } : {}),
    ...(coverageRequirement !== undefined ? { coverageRequirement } : {}),
    mutate,
    ...(tokensCssPath !== undefined ? { tokensCssPath } : {}),
    overrides,
    invariants,
    ...(repo !== undefined ? { repo } : {}),
    waveStatusPort,
  };

  return problems.list.length > 0
    ? { problems: problems.list }
    : { config, problems: [] };
}

/** The whole-file-absent case: every field at its default, and no `repo`. */
export function emptyConfig(): Config {
  return {
    planDir: "docs/planning",
    gateSteps: [],
    requiredCheck: "^Build",
    appendOnlyPaths: "",
    forbiddenPorts: [],
    operatorDataPaths: [],
    mutate: false,
    overrides: [],
    invariants: { ...LOCKED_INVARIANTS },
    waveStatusPort: DEFAULT_WAVE_STATUS_PORT,
  };
}

/** The default `waveStatusPort` — 4318, deliberately not campaign-foundry's 4317. */
export const DEFAULT_WAVE_STATUS_PORT = 4318;

const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  "planDir",
  "gateSteps",
  "requiredCheck",
  "appendOnlyPaths",
  "forbiddenPorts",
  "operatorDataPaths",
  "opencodeServerUrl",
  "waveLogDir",
  "coverageRequirement",
  "mutate",
  "tokensCssPath",
  "overrides",
  "invariants",
  "repo",
  "waveStatusPort",
]);

/**
 * Load the overlay config for a project, deriving `repo` from `gh` when the
 * file omits it (OW-D7: `repo` defaults to `gh repo view --json nameWithOwner`).
 *
 * An ABSENT file is not an error: the loader returns every default, and `doctor`
 * is the thing that decides whether a project with no overlay is a problem. The
 * brief's per-field defaults are the same ones that apply to a whole absent
 * file, except that `repo` then needs `gh`.
 */
export async function loadConfig(io: ConfigIo): Promise<ParseConfigResult> {
  const text = await io.readConfig();
  if (text === undefined) {
    const repo = await io.repo();
    return {
      config: { ...emptyConfig(), ...(repo !== undefined ? { repo } : {}) },
      problems: [],
    };
  }

  const parsed = parseConfig(text);
  if (parsed.config === undefined) return parsed;
  if (parsed.config.repo !== undefined) return parsed;

  const repo = await io.repo();
  if (repo === undefined) return parsed;
  if (!REPO_PATTERN.test(repo)) {
    return {
      config: parsed.config,
      problems: [
        ...parsed.problems,
        {
          at: "repo",
          message: `\`gh\` reported ${JSON.stringify(repo)}, which is not owner/name`,
        },
      ],
    };
  }
  return { config: { ...parsed.config, repo }, problems: parsed.problems };
}
