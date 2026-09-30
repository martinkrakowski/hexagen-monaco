import { TEMPLATE_CONFIG_FILE } from "../internal/template-config.js";
import {
  CONFIG_RELATIVE_PATH,
  type Config,
  type ConfigProblem,
} from "../internal/config.js";
import { configRefusal } from "../internal/refusal.js";

/**
 * `hexagen-orchestration-init` — scaffold a project's overlay.
 *
 * OW-D7: the overlay is never a template output. It is not declared in any
 * `manifest.json`, so the emitter never writes, hashes or conflict-copies it
 * and `hexagen add --force` never touches it. `init` is the only thing that
 * creates it.
 *
 * The governing rule is **skip if it exists**. Running `init` twice must leave
 * every file byte-identical, and must leave a file a human has since edited
 * exactly as edited. A scaffold that overwrites is not a scaffold; it is a
 * generator that runs on a directory someone works in, and the second run
 * silently reverts whatever they changed. So every write is guarded, and the
 * summary says which files were skipped — silence there would read as "nothing
 * to do" when the truth is "your edits are safe".
 */

export const TEMPLATE_ID = "orchestration";

/** Where the scaffolded files go, relative to the project root. */
export const OVERLAY_DIR = ".agents/orchestration";

/**
 * The four files `init` scaffolds. `config.yaml` is first because it is the
 * one every other bin reads, and a project with the other three but not this
 * one has a house style and no configuration.
 */
export const SCAFFOLD_FILES = [
  "config.yaml",
  "house-rules.md",
  "cast.md",
  "lessons.md",
] as const;

export type ScaffoldFile = (typeof SCAFFOLD_FILES)[number];

/** What `init` did, per file. */
export interface ScaffoldOutcome {
  readonly file: ScaffoldFile;
  readonly path: string;
  readonly action: "created" | "skipped";
}

/** The filesystem `init` needs, injected so the bin is testable. */
export interface InitDeps {
  readonly exists: (path: string) => Promise<boolean>;
  readonly write: (path: string, contents: string) => Promise<void>;
  /** The project's `.hexagen-template-config.json`, or `undefined` when absent. */
  readonly readTemplateConfig: () => Promise<string | undefined>;
}

/**
 * The recorded answer to the template's own `agents_md` question.
 *
 * Once `hexagen add orchestration` has run, the only place that boolean lives is
 * the install record's `answers` map — not a flag, and not anything `init`
 * could re-derive. So `init` reads it from there.
 *
 * `true` or ABSENT means include the Wave Observability section; only an
 * explicit `false` omits it. A project that never ran `add` has no opinion on
 * the question, and the section is the more useful default.
 */
export function readAgentsMdAnswer(
  templateConfigText: string | undefined,
): boolean {
  if (templateConfigText === undefined) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(templateConfigText);
  } catch {
    // A record this tool cannot read is not evidence of `false`.
    return true;
  }
  if (typeof parsed !== "object" || parsed === null) return true;
  const templates = (parsed as { templates?: unknown }).templates;
  if (typeof templates !== "object" || templates === null) return true;
  const record = (templates as Record<string, unknown>)[TEMPLATE_ID];
  if (typeof record !== "object" || record === null) return true;
  const answers = (record as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null) return true;
  const answer = (answers as Record<string, unknown>).agents_md;
  return answer !== false;
}

/**
 * The per-repository log directory `init` writes, or `undefined` when the
 * repository's name cannot be resolved.
 *
 * Nothing expands a `<placeholder>`: `logdir.ts` understands `$HOME`, `${HOME}`
 * and `~` and nothing else, so a scaffolded `.waves-<repo name>` would be a
 * directory with that literal name. The name half of `repo` is substituted
 * HERE, at scaffold time. With no `repo`, the key is omitted and the loader's
 * own default (`$HOME/.waves-<name>`, derived at run time) applies.
 */
export function defaultWaveLogDir(config: Config): string | undefined {
  if (config.waveLogDir !== undefined) return config.waveLogDir;
  const name = config.repo?.split("/")[1];
  return name !== undefined && name !== "" ? `$HOME/.waves-${name}` : undefined;
}

/** The scaffolded `config.yaml`, written with the values that must not be implied. */
export function renderConfig(config: Config): string {
  const waveLogDir = defaultWaveLogDir(config);
  const forbidden =
    config.forbiddenPorts.length > 0 ? config.forbiddenPorts : [3000, 3001];
  return [
    "# The orchestration overlay's single source (OW-D7).",
    "# Every value here is read at run time by the hexagen-orchestration bins;",
    "# none of them hardcodes a repository, a port or a log root.",
    "",
    "# Where plans live. plan-review and plan-verify read this, not a constant.",
    `planDir: ${config.planDir}`,
    "",
    "# The ordered gate steps. The `gate` bin runs exactly this list, in this",
    "# order, and prints it for --print-steps. `optional: true` may skip and is",
    "# reported as SKIPPED, never as passed. `locked: true` runs the step under",
    "# the machine-wide gate lock.",
    "gateSteps:",
    "  - name: build",
    "    command: yarn build",
    "  - name: typecheck",
    "    command: yarn typecheck",
    "  - name: lint",
    "    command: yarn lint",
    "  - name: test",
    "    command: yarn test",
    "",
    "# The check a pull request must show green before it merges.",
    `requiredCheck: ${JSON.stringify(config.requiredCheck)}`,
    "",
    ...(config.appendOnlyPaths !== undefined
      ? [
          "# Append-only paths, as a regular expression. A gate step that edits one",
          "# of these is a gate step that rewrote history.",
          `appendOnlyPaths: ${JSON.stringify(config.appendOnlyPaths)}`,
          "",
        ]
      : []),
    "# Ports the status server must refuse. This is the ONLY source of refused",
    "# ports (A-20): a port nobody listed here is a port nothing refuses.",
    `forbiddenPorts: [${forbidden.join(", ")}]`,
    "",
    "# Operator data the gate must not read, print, or diff.",
    `operatorDataPaths: [${config.operatorDataPaths.map((p) => JSON.stringify(p)).join(", ")}]`,
    "",
    "# The repository, as `gh repo view --json nameWithOwner` reports it. Also",
    "# derives the wave log directory below when that is left as the default.",
    ...(config.repo !== undefined
      ? [`repo: ${JSON.stringify(config.repo)}`]
      : ["# repo: (derive it with `gh repo view --json nameWithOwner`)"]),
    "",
    "# The port the status server binds. 4318 rather than 4317, so two projects",
    "# on one machine never collide.",
    `waveStatusPort: ${config.waveStatusPort}`,
    "",
    "# Where wave logs live. NEVER `~/.waves`: that directory is shared, and a",
    "# status server that scans it joins one project's waves against another",
    "# project's pull requests. `$HOME/.waves-<name>` is per-repository.",
    ...(waveLogDir !== undefined
      ? [`waveLogDir: ${JSON.stringify(waveLogDir)}`]
      : [
          "# waveLogDir is left unset: with no `repo` there is no name to derive it",
          "# from, so the loader's default applies once `repo` is known.",
        ]),
    "",
    "# Mutation replay. Off by default: it is opt-in, and a project that has not",
    "# asked for it does not get the cost.",
    `mutate: ${config.mutate}`,
    "",
    "# Invariants are LOCKED. Change one only by saying so here, and saying why:",
    "#",
    "# overrides:",
    "#   - invariant: eventDuty",
    "#     reason: the gate emits its own events, so a second writer would race",
    "invariants:",
    "  statusSource: derived",
    "  eventDuty: true",
    "  mergeRequiresGreenGate: true",
    "  attribution: false",
    "",
  ].join("\n");
}

/** The scaffolded `house-rules.md`, with or without the Wave Observability section. */
export function renderHouseRules(
  includeWaveObservability: boolean,
  waveLogDir?: string,
): string {
  const defaultDir =
    waveLogDir !== undefined
      ? `\`${waveLogDir}\``
      : "`$HOME/.waves-` followed by the name half of `repo`";
  const observability = includeWaveObservability
    ? [
        "## Wave Observability",
        "",
        "A delegated wave is only as good as its record. Three things make that",
        "record, and all three come from this overlay rather than from a constant:",
        "",
        "**Events.** Every lane appends to `<wave log dir>/events.jsonl` through",
        "`hexagen-orchestration-wave-event`. The log is the only source of what a",
        "wave did. Nothing is inferred from a process list or a directory name.",
        "",
        "**Status.** `hexagen-orchestration-wave-status` serves the wave from that",
        `log. Its port is \`waveStatusPort\` in \`.agents/orchestration/${CONFIG_RELATIVE_PATH.split("/").pop()}\`` +
          ` (${"default 4318"}), and it refuses every port in \`forbiddenPorts\`.`,
        "",
        "**The log directory is yours.** `waveLogDir` decides where waves are read",
        "from. It is per-repository on purpose. The default is",
        `${defaultDir} and never \`~/.waves\`. That directory is shared`,
        "between projects, and a status server that scans it will read another",
        "project's waves and report them as this project's.",
        "",
        "> **Action for the human:** paste the section above into `AGENTS.md`.",
        "> It is the one instruction in this overlay that a tool cannot carry for",
        "> you, and an agent that has not read it will not know the wave is",
        "> observable at all.",
        "",
      ]
    : [];

  return [
    "# House rules",
    "",
    "Rules this project holds itself to. Written for the agent that will work",
    "here, so each one says what to do rather than what to avoid.",
    "",
    ...observability,
    "## Working here",
    "",
    "- Read `.agents/orchestration/config.yaml` before starting. It is the source",
    "  for the plan directory, the gate steps and the ports in play.",
    "- A rule with no test is not a rule. Name the test.",
    "- When something is discovered that should have been known earlier, it goes",
    "  in `lessons.md`, with the source it came from.",
    "",
  ].join("\n");
}

const CAST = [
  "# Cast",
  "",
  "Who works here, and what each of them is accountable for. A seat with no",
  "recorded judgement is a seat nobody can learn from.",
  "",
  "| Seat | Accountable for |",
  "| --- | --- |",
  "",
  "Add a row per seat. Leave the table's header in place even when it is empty —",
  "an empty table is a record that no seat has been graded yet, which is a",
  "different and more useful thing than no table at all.",
  "",
].join("\n");

const LESSONS = [
  "# Lessons",
  "",
  "Things learned the expensive way, so the next wave does not pay for them",
  "again.",
  "",
  "Each entry names where the lesson came from. An entry with no source is a",
  "guess wearing the same clothes as a finding.",
  "",
  "## Format",
  "",
  "```",
  "### What happened",
  "",
  "### Why it was not caught",
  "",
  "### Source",
  "",
  "```",
  "",
].join("\n");

/** The contents `init` would write for one file, given the project's config. */
export function renderFile(
  file: ScaffoldFile,
  config: Config,
  includeWaveObservability: boolean,
): string {
  switch (file) {
    case "config.yaml":
      return renderConfig(config);
    case "house-rules.md":
      return renderHouseRules(
        includeWaveObservability,
        defaultWaveLogDir(config),
      );
    case "cast.md":
      return CAST;
    case "lessons.md":
      return LESSONS;
  }
}

/**
 * Scaffold the overlay, skipping every file that already exists.
 *
 * Returns one outcome per file, in the order they were considered, so the bin
 * can report exactly what it did and what it left alone.
 */
export async function runInit(
  config: Config,
  deps: InitDeps,
): Promise<{
  readonly outcomes: readonly ScaffoldOutcome[];
  readonly includeWaveObservability: boolean;
}> {
  const includeWaveObservability = readAgentsMdAnswer(
    await deps.readTemplateConfig(),
  );
  const outcomes: ScaffoldOutcome[] = [];

  for (const file of SCAFFOLD_FILES) {
    const path = `${OVERLAY_DIR}/${file}`;
    if (await deps.exists(path)) {
      outcomes.push({ file, path, action: "skipped" });
      continue;
    }
    await deps.write(path, renderFile(file, config, includeWaveObservability));
    outcomes.push({ file, path, action: "created" });
  }

  return { outcomes, includeWaveObservability };
}

/** What `init` printed, kept here so the bin stays a thin edge. */
export function formatReport(outcomes: readonly ScaffoldOutcome[]): string {
  const lines: string[] = [];
  for (const { path, action } of outcomes) {
    lines.push(`${action === "created" ? "created" : "kept    "}  ${path}`);
  }
  const created = outcomes.filter((o) => o.action === "created").length;
  const kept = outcomes.length - created;
  lines.push(
    kept === 0
      ? `init: wrote ${created} file(s) into ${OVERLAY_DIR}/.`
      : `init: wrote ${created}, left ${kept} untouched (an existing file is never overwritten).`,
  );
  return lines.join("\n");
}

/** The path of the install record `init` reads the template's answers from. */
export const TEMPLATE_CONFIG_PATH = TEMPLATE_CONFIG_FILE;

/**
 * The whole bin, minus the process: refuse on an invalid overlay, otherwise
 * scaffold and report.
 *
 * `init` ACTS on the config (it renders `config.yaml`'s neighbours from it), so a
 * present file with problems is a refusal: exit 2, every problem printed, no
 * file created and none touched. A file that fails validation holds defaults
 * for the bad fields, and scaffolding from those would write a house style that
 * disagrees with the config sitting next to it. An ABSENT file is the normal
 * case for `init` and is not a refusal.
 */
export async function initProject(
  loaded: {
    readonly config: Config;
    readonly present: boolean;
    readonly problems: readonly ConfigProblem[];
  },
  deps: InitDeps,
): Promise<{ readonly code: number; readonly lines: readonly string[] }> {
  const refusal = configRefusal("init", "scaffold", loaded);
  if (refusal !== undefined) return { code: 2, lines: refusal };
  const { outcomes } = await runInit(loaded.config, deps);
  return {
    code: 0,
    lines: [
      formatReport(outcomes),
      outcomes.some((o) => o.action === "created")
        ? "init: run `hexagen-orchestration-doctor` next to check the overlay."
        : `init: ${OVERLAY_DIR}/ is already complete; nothing was changed.`,
    ],
  };
}
