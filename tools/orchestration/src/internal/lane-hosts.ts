import type { ConfigDeprecation, ConfigProblem } from "./config.js";

/**
 * `laneHosts` and `seats` — where a delegated lane dispatches, and through which
 * opencode seat (§12.4 A-30).
 *
 * `laneHosts` says **where and how**. A delegated lane can run on a remote
 * opencode server that executes tools on the server side, so a host is not a
 * URL: it is a transport prefix, a worktree root and, when it is remote, an ssh
 * alias and a clone path. `seats` says **who** — the machine-readable dispatch
 * identity of an opencode seat, which `cast.md` refers to by `id`.
 *
 * The schema here is deliberately STRICTER than `gateSteps[i]`: an unknown key
 * inside a lane host or a seat is a problem naming the key, because a lane host
 * is what a lane's tools run on, and a key nothing reads is a key the author
 * believed was obeyed.
 *
 * The one thing this module does NOT do is refuse. `opencodeServerUrl` is a
 * deprecated alias: an overlay that still sets it keeps working, and gets a
 * synthesized local host plus a deprecation. A deprecation is a WARN channel;
 * only `problems` refuses.
 */

/** The gate scope a host can reproduce. `targeted-only` means it cannot do CI. */
export type LaneHostGate = "full" | "targeted-only";

/** One place a lane can dispatch to. Remote when any of ssh/clone/worktrees is set. */
export interface LaneHost {
  /** The overlay's label for this host, unique, and what a `seats[].host` names. */
  readonly name: string;
  /** The transport prefix only. The orchestrator appends `--dir`, `--agent`, `-m`, `--format`. */
  readonly dispatch: readonly string[];
  readonly gate: LaneHostGate;
  /** Exits 0 if and only if the dispatch path itself works. Required on a remote host. */
  readonly check?: readonly string[];
  /** `<usage…> <server worktree path>`, for wall time and tokens. doctor never runs it. */
  readonly usage?: readonly string[];
  /** An ssh alias. Its presence is what makes a host remote. */
  readonly ssh?: string;
  /** Absolute: this repository's clone on the host. */
  readonly clone?: string;
  /** Absolute: the root under which lane worktrees are created there. */
  readonly worktrees?: string;
  /** Remote hosts only: run as `ssh <alias> -- <install…>` inside the new worktree. */
  readonly install?: readonly string[];
}

/** One opencode-dispatched seat, and the host it dispatches through. */
export interface Seat {
  /** Unique token. `cast.md` refers to a seat by this and never restates its model. */
  readonly id: string;
  /** The host-side agent, e.g. a sandboxed `lane` agent. */
  readonly agent: string;
  readonly model: string;
  /** Must name a `laneHosts[].name`. */
  readonly host: string;
}

/** The name reserved for the host synthesized from the deprecated alias. */
export const SYNTHESIZED_HOST_NAME = "opencode-server";

const HOST_KEYS = [
  "name",
  "dispatch",
  "gate",
  "check",
  "usage",
  "ssh",
  "clone",
  "worktrees",
  "install",
] as const;

const SEAT_KEYS = ["id", "agent", "model", "host"] as const;

/** Flags the ORCHESTRATOR appends, so a host may not carry them itself. */
const RESERVED_DISPATCH_FLAGS = [
  "--dir",
  "--agent",
  "-m",
  "--model",
  "--format",
];

/** A host label and a seat id: lowercase, hyphen-separated, never an ssh alias. */
const TOKEN = /^[a-z][a-z0-9-]*$/;

/** An ssh alias. The first character class is what forbids a leading `-`. */
const SSH_ALIAS = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

export interface LaneHostsParse {
  readonly hosts: readonly LaneHost[];
  readonly seats: readonly Seat[];
  readonly problems: readonly ConfigProblem[];
  readonly deprecations: readonly ConfigDeprecation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** An argv array of non-empty strings. `undefined` for absent or for refused. */
function parseArgv(
  raw: unknown,
  at: string,
  add: (at: string, message: string) => void,
): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((item) => !isNonEmptyString(item))
  ) {
    add(at, "must be a non-empty list of non-empty strings");
    return undefined;
  }
  return raw as readonly string[];
}

/** An absolute path on the host. `undefined` for absent or for refused. */
function parseHostPath(
  raw: unknown,
  at: string,
  add: (at: string, message: string) => void,
): string | undefined {
  if (raw === undefined) return undefined;
  if (!isNonEmptyString(raw)) {
    add(at, "must be a non-empty string");
    return undefined;
  }
  if (!raw.startsWith("/")) {
    add(
      at,
      `must be an ABSOLUTE path on the host. Read ${JSON.stringify(raw)}`,
    );
    return undefined;
  }
  return raw;
}

/**
 * One `laneHosts` entry, or `undefined` when it cannot be represented at all.
 *
 * An entry with a valid `name`, `dispatch` and `gate` is KEPT even when a later
 * check refused it, because `doctor` still has to report on it and an operator
 * fixing the file needs to see the host the problems are about. Only a missing
 * name, dispatch or gate — the three that make a host nameable and dispatchable
 * — drops it.
 */
function parseHost(
  entry: unknown,
  index: number,
  seen: Map<string, number>,
  add: (at: string, message: string) => void,
): LaneHost | undefined {
  const at = `laneHosts[${index}]`;
  if (!isRecord(entry)) {
    add(at, "must be a mapping with `name`, `dispatch` and `gate`");
    return undefined;
  }
  for (const key of Object.keys(entry)) {
    if (!(HOST_KEYS as readonly string[]).includes(key)) {
      add(
        `${at}.${key}`,
        `is not a known laneHosts key. Known keys: ${HOST_KEYS.join(", ")}`,
      );
    }
  }

  // `name` — required, a token, and unique.
  let name: string | undefined;
  if (!isNonEmptyString(entry.name)) {
    add(
      `${at}.name`,
      "is required: a seat dispatches through a host BY NAME, and so does doctor",
    );
  } else if (!TOKEN.test(entry.name)) {
    add(
      `${at}.name`,
      `must be a lowercase token matching ${TOKEN.source}, and unique. Read ${JSON.stringify(entry.name)}`,
    );
  } else if (seen.has(entry.name)) {
    add(
      `${at}.name`,
      `is a duplicate: ${JSON.stringify(entry.name)} is already laneHosts[${seen.get(entry.name)}]`,
    );
  } else {
    name = entry.name;
    // Recorded HERE, not at the return: a host dropped below for a bad gate or
    // dispatch still declared this name, and a later duplicate, a seat naming it
    // and the synthesized `opencode-server` all have to see that.
    seen.set(name, index);
  }

  // `dispatch` — required, and the transport prefix ONLY.
  const dispatch = parseArgv(entry.dispatch, `${at}.dispatch`, add);
  if (entry.dispatch === undefined) {
    add(
      `${at}.dispatch`,
      "is required: it is the argv prefix the orchestrator dispatches a lane through",
    );
  }
  if (dispatch !== undefined) {
    for (const flag of RESERVED_DISPATCH_FLAGS) {
      // The LONG flags are also refused in their `--flag=value` form. The short
      // flag's attached form (`-mfoo`) is deliberately NOT tried: `-m` followed by
      // anything is ambiguous with other short flags and with a value that merely
      // starts with `m`, so a prefix match there would refuse legitimate words.
      if (
        dispatch.some(
          (word) =>
            word === flag ||
            (flag.startsWith("--") && word.startsWith(`${flag}=`)),
        )
      ) {
        add(
          `${at}.dispatch`,
          `must not contain ${flag}: the orchestrator appends it, so a ${flag} here would dispatch with the wrong value`,
        );
      }
    }
  }

  // `gate` — required, and the gate scope ON THAT HOST, not the gate bin.
  let gate: LaneHostGate | undefined;
  if (!isNonEmptyString(entry.gate)) {
    add(`${at}.gate`, "is required, and must be one of: full, targeted-only");
  } else if (entry.gate !== "full" && entry.gate !== "targeted-only") {
    add(
      `${at}.gate`,
      `must be one of: full, targeted-only. Read ${JSON.stringify(entry.gate)}`,
    );
  } else {
    gate = entry.gate;
  }

  // `ssh` — an alias, and its PRESENCE is what makes the host remote.
  let alias: string | undefined;
  if (entry.ssh !== undefined) {
    if (!isNonEmptyString(entry.ssh)) {
      add(`${at}.ssh`, "must be a non-empty string");
    } else if (!SSH_ALIAS.test(entry.ssh)) {
      add(
        `${at}.ssh`,
        `must be an ssh alias matching ${SSH_ALIAS.source}, so no leading \`-\`. Read ${JSON.stringify(entry.ssh)}`,
      );
    } else {
      alias = entry.ssh;
    }
  }

  const clone = parseHostPath(entry.clone, `${at}.clone`, add);
  const worktrees = parseHostPath(entry.worktrees, `${at}.worktrees`, add);
  const check = parseArgv(entry.check, `${at}.check`, add);
  const usage = parseArgv(entry.usage, `${at}.usage`, add);
  const install = parseArgv(entry.install, `${at}.install`, add);

  // A host is REMOTE when any of ssh/clone/worktrees is present. Remote is a
  // fact about the entry as written, not about what survived validation: a host
  // whose `ssh` is malformed is still a remote host, and reporting it as local
  // would report a different defect than the one that is there.
  const remote =
    entry.ssh !== undefined ||
    entry.clone !== undefined ||
    entry.worktrees !== undefined;

  if (remote) {
    const because = (key: string) =>
      `is required on a remote host, and this is one: a host is remote when any of \`ssh\`, \`clone\` or \`worktrees\` is present. ${key}`;
    const missing = [
      entry.ssh === undefined ? "ssh" : undefined,
      entry.clone === undefined ? "clone" : undefined,
      entry.worktrees === undefined ? "worktrees" : undefined,
      entry.check === undefined ? "check" : undefined,
    ].filter((key): key is string => key !== undefined);
    if (entry.ssh === undefined) {
      add(
        `${at}.ssh`,
        because(
          "It is how the orchestrator creates the worktree, places the brief and fetches the lane's commits back.",
        ),
      );
    }
    if (entry.clone === undefined) {
      add(
        `${at}.clone`,
        because(
          "It is the path of this repository's clone there, for the fetch and the worktree add.",
        ),
      );
    }
    if (entry.worktrees === undefined) {
      add(
        `${at}.worktrees`,
        because(
          "Lane worktrees are created there, as <worktrees>/<lane worktree name>.",
        ),
      );
    }
    if (entry.check === undefined) {
      add(
        `${at}.check`,
        because(
          "It is what proves the dispatch path itself works before a lane is sent, and a check that only proves the server is up can pass while the dispatch fails.",
        ),
      );
    }
    // §7's "a local host that carries ssh": `ssh` is the key that PROMISED a
    // remote host, so when it arrives with NEITHER `clone` nor `worktrees` the
    // broken promise is reported on `ssh` too, where the operator has to act on
    // it. With one of them present the missing key is already named on its own,
    // and a second problem at `ssh` would only send the operator to the wrong line.
    if (
      entry.ssh !== undefined &&
      entry.clone === undefined &&
      entry.worktrees === undefined
    ) {
      add(
        `${at}.ssh`,
        `is set, so this host is remote, but a remote host must declare \`clone\` and \`worktrees\` as well. Missing: ${missing.join(", ")}`,
      );
    }
  }

  if (install !== undefined && !remote) {
    add(
      `${at}.install`,
      "is only meaningful on a remote host, and this host is LOCAL: it declares no `ssh`, `clone` or `worktrees`. The orchestrator runs `yarn install --immutable` in a local worktree itself",
    );
  }

  if (name === undefined || dispatch === undefined || gate === undefined) {
    return undefined;
  }
  return {
    name,
    dispatch,
    gate,
    ...(check !== undefined ? { check } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(alias !== undefined ? { ssh: alias } : {}),
    ...(clone !== undefined ? { clone } : {}),
    ...(worktrees !== undefined ? { worktrees } : {}),
    ...(install !== undefined ? { install } : {}),
  };
}

/** One `seats` entry, or `undefined` when it cannot be represented at all. */
function parseSeat(
  entry: unknown,
  index: number,
  hosts: ReadonlySet<string>,
  seen: Set<string>,
  add: (at: string, message: string) => void,
): Seat | undefined {
  const at = `seats[${index}]`;
  if (!isRecord(entry)) {
    add(at, "must be a mapping with `id`, `agent`, `model` and `host`");
    return undefined;
  }
  for (const key of Object.keys(entry)) {
    if (!(SEAT_KEYS as readonly string[]).includes(key)) {
      add(
        `${at}.${key}`,
        `is not a known seat key. Known keys: ${SEAT_KEYS.join(", ")}`,
      );
    }
  }

  let id: string | undefined;
  if (!isNonEmptyString(entry.id)) {
    add(`${at}.id`, "is required: `cast.md` refers to a seat BY ID");
  } else if (!TOKEN.test(entry.id)) {
    add(
      `${at}.id`,
      `must be a lowercase token matching ${TOKEN.source}, and unique. Read ${JSON.stringify(entry.id)}`,
    );
  } else if (seen.has(entry.id)) {
    add(
      `${at}.id`,
      `is a duplicate: ${JSON.stringify(entry.id)} appears twice`,
    );
  } else {
    id = entry.id;
    // Recorded HERE, not at the return: a seat dropped below for a dangling host
    // or a missing agent still declared this id, and a later seat with the same id
    // is a duplicate of it all the same (the same defect as a dropped host's name).
    seen.add(id);
  }

  const agent = isNonEmptyString(entry.agent) ? entry.agent : undefined;
  if (agent === undefined) {
    add(
      `${at}.agent`,
      "is required: it is the host-side agent this seat dispatches, e.g. a sandboxed `lane` agent",
    );
  }
  const model = isNonEmptyString(entry.model) ? entry.model : undefined;
  if (model === undefined) {
    add(
      `${at}.model`,
      "is required: the orchestrator dispatches this seat with `-m <model>`",
    );
  }

  let host: string | undefined;
  if (!isNonEmptyString(entry.host)) {
    add(`${at}.host`, "is required: it must name a `laneHosts[].name`");
  } else if (!hosts.has(entry.host)) {
    // Referential integrity, and the reason it is a PROBLEM: a seat that
    // dispatches through a host nobody declared is a lane with nowhere to run,
    // and it reads as configured.
    add(
      `${at}.host`,
      `names no laneHosts[] entry. Known hosts: ${[...hosts].map((name) => JSON.stringify(name)).join(", ") || "(none)"}`,
    );
  } else {
    host = entry.host;
  }

  if (
    id === undefined ||
    agent === undefined ||
    model === undefined ||
    host === undefined
  ) {
    return undefined;
  }
  return { id, agent, model, host };
}

/**
 * `laneHosts[]`, `seats[]`, and the deprecation channel the retired
 * `opencodeServerUrl` feeds.
 *
 * `serverUrl` is the ALREADY-VALIDATED alias (a string, or `undefined` when the
 * file omitted it or set it to something that is not a string — that refusal is
 * `parseConfig`'s, at `opencodeServerUrl`). When it is a string, a local host is
 * synthesized from it, so an overlay that predates `laneHosts` keeps dispatching
 * exactly as before while the operator is told, once, to migrate.
 */
export function parseLaneHosts(
  rawHosts: unknown,
  rawSeats: unknown,
  serverUrl: string | undefined,
): LaneHostsParse {
  const problems: ConfigProblem[] = [];
  const deprecations: ConfigDeprecation[] = [];
  const add = (at: string, message: string): void => {
    problems.push({ at, message });
  };

  const hosts: LaneHost[] = [];
  // Every name the FILE declared, whether or not the entry survived: a seat's
  // `host` reference is not itself the defect, so a typo in a host's `gate` must
  // not also read as a seat pointing at nothing.
  const declared = new Map<string, number>();
  if (rawHosts !== undefined && !Array.isArray(rawHosts)) {
    add("laneHosts", "must be a list of lane host entries");
  } else {
    (rawHosts ?? []).forEach((entry, index) => {
      const host = parseHost(entry, index, declared, add);
      if (host !== undefined) hosts.push(host);
    });
  }

  if (serverUrl !== undefined) {
    const collision = declared.get(SYNTHESIZED_HOST_NAME);
    if (collision === undefined) {
      hosts.push({
        name: SYNTHESIZED_HOST_NAME,
        dispatch: ["opencode", "run", "--attach", serverUrl],
        gate: "full",
        // One trailing `/` is dropped, so `http://h:4096/` does not become `//doc`.
        check: ["curl", "-sf", `${serverUrl.replace(/\/$/, "")}/doc`],
      });
      declared.set(SYNTHESIZED_HOST_NAME, hosts.length - 1);
    } else {
      // The DECLARED host wins: two entries with one name would make
      // `seats[].host` ambiguous, which is the same defect as no host at all.
      add(
        `laneHosts[${collision}].name`,
        `collides with the host synthesized from \`opencodeServerUrl\`. Rename this host, or drop \`opencodeServerUrl\` and declare the host yourself.`,
      );
    }
    deprecations.push({
      at: "opencodeServerUrl",
      message:
        `is deprecated and will be removed. A local \`laneHosts\` entry named ` +
        `${JSON.stringify(SYNTHESIZED_HOST_NAME)} was synthesized from it; declare that host yourself, ` +
        `as { name, dispatch: [opencode, run, --attach, <url>], gate: full, check: [curl, -sf, <url>/doc] }.`,
    });
  }

  const known = new Set(declared.keys());
  const seats: Seat[] = [];
  const seatIds = new Set<string>();
  if (rawSeats !== undefined && !Array.isArray(rawSeats)) {
    add("seats", "must be a list of seat entries");
  } else {
    (rawSeats ?? []).forEach((entry, index) => {
      const seat = parseSeat(entry, index, known, seatIds, add);
      if (seat !== undefined) seats.push(seat);
    });
  }

  return { hosts, seats, problems, deprecations };
}
