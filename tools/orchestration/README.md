# @hexagen/orchestration

Wave orchestration tooling for a HexaGen project, packaged as
command-line bins (the table below lists them all).

The package carries the machinery a delegated wave needs to be observable and
verifiable: emitting events, verifying and reviewing the plan, reporting status,
running the gate under a lock, and keeping a project's overlay healthy.

## The overlay

The package reads one file from the project root:

```
.agents/orchestration/config.yaml
```

`hexagen-orchestration-init` scaffolds it (skipping any file that already
exists) alongside `house-rules.md`, `cast.md`, `lessons.md`, and the lane
handoff directory's own `.lane/.gitignore`.
`hexagen-orchestration-doctor` validates it and reports anything the project is
missing.

Nothing in the package hardcodes a repository, a port or a log root — every one
of those comes from the overlay, so the same package serves any project that
adopts it.

### `ciWorkflow`

`ciWorkflow` — the repository-relative path of the CI workflow `doctor` requires.
Default `.github/workflows/ci.yml`. A project whose gate workflow has another
name sets it, for example `ciWorkflow: .github/workflows/sync-integrity.yml`;
`doctor` then FAILs, naming that path, when the file is missing. It must be a
non-empty string, not absolute, with no `..` segment and no NUL. `init` does
not write it, so a scaffolded overlay keeps the default.

### `installProbes`

`installProbes` is an optional list of `{ package, check, repair?, platform? }`. It guards
against a dependency whose postinstall output is silently skipped when installs
run concurrently on one host. `check` and `repair` are argv lists, validated
like `laneHosts[].check`.

```yaml
installProbes:
  - package: "@esbuild/darwin-arm64"
    check: [node, -e, "require.resolve('@esbuild/darwin-arm64/bin/esbuild')"]
    repair:
      - sh
      - -c
      - rm -rf node_modules/@esbuild/darwin-arm64 && yarn install
    platform: darwin
```

A plain `yarn install` does not restore a stripped package directory, because
the directory's presence makes the package look installed. So the repair removes
the directory first.

- On a remote lane host, the orchestrator runs each probe as
  `ssh <alias> -- sh -c 'cd "$1" && shift && exec "$@"' sh <remote worktree path> <check argv…>`.
  That runs the probe in the new worktree, and every argv word is its own
  argument, so nothing is shell-joined. `repair` uses the same form. On a local
  host it runs the `check` with its cwd set to the new worktree.
- `platform` (optional: `darwin`, `linux` or `win32`, Node's
  `process.platform` values) limits a probe to hosts of that platform. The
  orchestrator runs it only on a lane host whose platform matches, found on a
  remote host with `ssh <alias> -- uname -s` (Darwin is darwin, Linux is
  linux). `doctor` runs it only when `process.platform` matches, and otherwise
  reports one INFO line: `skipped (platform <p>, this host <q>)`.
- An unknown key in a probe is a problem naming the known keys, and the probe is
  dropped.
- After a failed `check` the orchestrator runs `repair` once, in the same
  worktree on the same host, then runs `check` again. A repair is logged as a
  wave event. If `check` still fails, or `repair` is absent or exits non-zero,
  the worktree is not dispatched, and the failure names the package and both
  exit codes.
- `doctor` runs each `check` on the orchestrator's host only, never runs
  `repair`, and reports a failing `check` as `FAIL`.

## Lane hosts and seats

A delegated lane can run on a remote opencode server that executes tools on the
server side, so where a lane runs is not a URL. Two settings say it:

`laneHosts` — **where and how.** Each entry declares `name`, `dispatch` (the
transport prefix only; never `--dir`, `--agent`, `-m`, `--model` or `--format`,
which the orchestrator appends) and `gate` (`full` or `targeted-only`, the gate
scope on that host). A host is **remote** when it carries `ssh`, `clone` or
`worktrees`, and a remote host must carry all three plus `check`. `check` exits 0
if and only if the dispatch path itself works: it runs no lane and writes no
opencode session.

`server` (optional) is the loopback URL of the host's opencode server, as seen
from the orchestrator through its tunnel, for example `http://127.0.0.1:4097`.
A non-loopback or malformed value is a problem at `laneHosts[i].server`.

`usage` (optional) is the argv of the host's usage reader. It is invoked as

```bash
<usage…> --server <laneHosts[].server> --session <id>
```

where `<id>` is the session id the orchestrator recorded from the lane's first
`--format json` event. That form applies when the host declares `server`. A host
with no `server` keeps the legacy form, `<usage…> <worktree path>`, and
`doctor` reports one `INFO` line for it ("usage reader invoked in the legacy
worktree form"). The reader this package
ships for it is `hexagen-orchestration-lane-watch usage`, and `doctor` WARNs
when `usage[0]` is that bin but the host has no `server`. `doctor` never runs
`usage`.

`seats` — **who.** Each entry declares `id`, `agent`, `model`, and a `host`
naming a `laneHosts[].name`. `cast.md` refers to a seat by its `id` and never
restates its agent or model.

`doctor` reports on both: that `dispatch[0]` is on `PATH`, that the ssh probe
reaches a remote host, that `check` passes, and that the clone's `user.email`
matches this repository's. A host no seat references is a `WARN`, and a `WARN`
never affects the exit code.

### `opencodeServerUrl` is deprecated

`opencodeServerUrl` is no longer a setting. An overlay that still sets it keeps
working: `parseConfig` synthesizes a local `laneHosts` entry named
`opencode-server` (its `server` is the URL the alias held), and reports a deprecation, which `doctor` prints as a `WARN`.
A deprecation never refuses — `init`, `gate` and every other bin act on the
config regardless — so an overlay can be migrated on its own schedule.

### Fix rounds on an opencode lane

A fix round resumes the lane's own session when the dispatch transport supports
it, and forks that session when the branch has moved since the lane's last turn
(a merge, a refresh). With opencode the orchestrator passes `run -s <sessionID>`
to resume and adds `--fork` to fork, using the `sessionID` it recorded from the
first `--format json` event of the dispatch. These flags are orchestrator-side:
they never appear in a lane brief. Stagger forked resumes by about 20 s, because
two forks launched in the same second fail with "database is locked" (opencode's
sqlite).

## Bins

Every bin is prefixed `hexagen-orchestration-`, so none of them can collide with
another dependency's bin in a consumer's `node_modules/.bin`.

| Bin                                      | What it does                                        |
| ---------------------------------------- | --------------------------------------------------- |
| `hexagen-orchestration-wave-event`       | Append one event to a wave's `events.jsonl`         |
| `hexagen-orchestration-plan-verify`      | Check a plan's premises                             |
| `hexagen-orchestration-plan-review`      | Hash plan rows, review a high-risk lane             |
| `hexagen-orchestration-wave-status`      | Serve a wave's status                               |
| `hexagen-orchestration-handoff-check`    | Check a handoff is ready                            |
| `hexagen-orchestration-control-bytes`    | Scan tracked files for control bytes                |
| `hexagen-orchestration-gate`             | Run the project's configured gate steps             |
| `hexagen-orchestration-gate-lock`        | Hold the gate lock across a command                 |
| `hexagen-orchestration-sweep`            | Sweep a PR's review threads                         |
| `hexagen-orchestration-fix-brief`        | Draft a fix-round brief from a PR's open threads    |
| `hexagen-orchestration-brief-new`        | Write a lane-brief skeleton for a lane host         |
| `hexagen-orchestration-lane-watch`       | Follow a lane's progress, read its usage            |
| `hexagen-orchestration-merge-prs`        | Merge ready pull requests                           |
| `hexagen-orchestration-verify-manifests` | Verify mutation manifests                           |
| `hexagen-orchestration-mutate`           | Replay mutations                                    |
| `hexagen-orchestration-mutate-verify`    | Verify a replayed manifest                          |
| `hexagen-orchestration-mutate-anchors`   | Verify a manifest's anchors                         |
| `hexagen-orchestration-init`             | Scaffold the project's overlay                      |
| `hexagen-orchestration-doctor`           | Validate the overlay and the project's capabilities |

### `hexagen-orchestration-gate-lock`

```bash
hexagen-orchestration-gate-lock run <lane> -- <command...>
```

Holds the gate lock around one command. The lock is a directory under
`${TMPDIR:-/tmp}`, shared by every checkout and project on the host, and a
holder that dies is reclaimed. Exit 75 means every slot is held by a live
holder (or, see below, that this worktree already has a gate): sleep and retry.

**Slots.** `HEXAGEN_GATE_SLOTS` is a host-wide environment variable, never an
overlay field: the count belongs to the host, the lock directory is shared, and
a lane runs `gate-lock run` without the `gate` bin, so no overlay is read. It is
an integer from 1 to 64, default 1; anything else exits 2 and names the value.
With 1 there is one lock, as before. With N > 1 a caller takes the first free of
N slots. `doctor` prints the value it sees as an `INFO` line; a value that is
set but invalid is a `FAIL` instead (exit non-zero), because every gate on the
host would refuse to run. `INFO` is a severity of its own, not a line in the
summary, because `formatReport` has no access to the environment, so a summary
line would have needed a new parameter threaded through it; an `INFO` finding
uses the path every other finding does and never counts as a problem or a
warning.

**Slot-out file.** Set `HEXAGEN_GATE_SLOT_OUT` to a path and a successful
acquire writes the slot number it won there. A refused acquire never writes it.

**One gate per worktree.** The caller's worktree is `git rev-parse --show-toplevel`,
else `pwd -P`, and is stored in its slot. A caller that wins a slot while
another live holder has the same worktree gives its slot back and exits 75 with
`same worktree`, before the slot-out file is written. An empty identity (a
deleted working directory, for one) exits 2.

**Test-worker cap.** More than one slot only helps if the test runner is capped
so the slots do not oversubscribe the host: `slots x maxWorkers <= threads`. Set
that in the consumer's test-runner config. Never also set `VITEST_MAX_WORKERS`:
vitest applies it unvalidated and it takes precedence over the config. Vitest 4
has no `minWorkers` option.

### `hexagen-orchestration-brief-new`

```bash
hexagen-orchestration-brief-new --lane <id> --plan <path> --branch <name> \
  --tip <sha> --host <laneHosts name> [--env KEY=VALUE]... [--out <path>]
```

Writes a lane-brief skeleton from Template A in the orchestrate-wave skill's
`references/briefs.md`, with its lane-host variant resolved against the named
host. It fills `<LANE>`, `<PLAN_PATH>`, `<BRANCH>` and `<SHA>`; the rest
(`<N>`, `<REPO_PATH>`, `<WORKTREE_PATH>`, `<SECTIONS>`, the ownership list,
the tasks) are for the orchestrator to fill before dispatch.

- Every value flag takes `--flag value` or `--flag=value`. Use the second form for a
  value that starts with `--` (`--out=--draft.md`): in the first form a word
  starting with `--` is the next flag, so the value is missing. `--flag=` is an
  empty value and is refused.
- `--host` names a `laneHosts[].name` in the overlay. Its `gate` and whether it
  is remote (any of `ssh`, `clone` or `worktrees` set) decide the brief. The
  lane-host variant applies when the host is `targeted-only` OR remote: the
  lane commits only and never pushes. A `targeted-only` host also forbids the
  full gate and tells the lane to run the listed targeted checks only; a remote
  `full` host says the orchestrator runs the full gate after fetching the
  commits. Only a local `full` host drops the variant, and its brief requires
  the full gate before pushing.
- `--env KEY=VALUE` is repeatable. Each line is written into the brief verbatim,
  in a fenced block, in the order given.
- Refused with exit 2, naming the flag, before the overlay is loaded: a `--lane`
  outside `^[A-Za-z0-9_-]+$`; a `--plan` or `--branch` outside
  `^[A-Za-z0-9._/-]+$`; a `--tip` outside `^[0-9a-f]{7,40}$`; any value
  (including `--host` and `--out`) that carries a control, format, or line or
  paragraph separator character; an
  `--env` that is not `KEY=VALUE`; any other flag given twice. An unknown
  `--host` is also exit 2, once the overlay is read.
- `--out` is held to the same single-line rule, because it is echoed in the
  summary line. It creates its directory if it is missing, and refuses an existing file
  (exit 1), checked before writing and again by an exclusive write. Without it,
  the brief goes to stdout.

### `hexagen-orchestration-lane-watch`

```bash
hexagen-orchestration-lane-watch follow --server <url> --session <id> [--stall-seconds <n>]
hexagen-orchestration-lane-watch usage  --server <url> --session <id>
```

Reads an opencode server's HTTP API to report one lane's progress and usage. It
is the documented `usage` reader for a lane host (see `laneHosts[].usage`).

- `--server` must be a **loopback** http(s) origin (`127.x.x.x`, `localhost` or
  `[::1]`) with no path, so a non-loopback value exits 2. A remote server is
  reached through a local tunnel, and keeping that tunnel open while `follow`
  runs is the caller's job.
- `--session` must be letters, digits, `_` and `-`; anything else exits 2.
  Both are checked before any request is made.
- `follow` reads `GET /global/event` (server-sent events), keeps only frames for
  the session, prints tool and step progress, and ends 0 on `session.idle` (or a
  `session.status` of `idle`), at that frame, without another read. The stall
  timer (default 120 s) measures silence from the session itself:
  `server.heartbeat` frames and other sessions' events do not reset it, and it is
  armed before the connection opens, so a connect that never answers is a stall.
  A stall exits 4 and prints `stall: no events for <n> s (if the lane finished
before follow connected, run "lane-watch usage")`. Known limitation: `follow`
  cannot ask the server whether the session is already idle, because it may only
  request `/global/event` and `/session/<id>`, so a lane that finished before
  `follow` connected is seen as a stall; run `usage` for it instead.
- `usage` reads `GET /session/<id>`, refuses a record whose `id` is not the
  requested session (exit 1), gives up after 30 s with a `timeout:` line (exit 1),
  and prints `secs`, `tokens` and `cost`. A
  field the server did not report is printed as `unknown`, and any unknown field
  exits 3, never 0: a partial reading is incomplete.
- Every request refuses redirects, goes through one helper that allows only
  `/global/event` and `/session/<id>`, and is aborted on every exit path. An
  event line or frame over 1 MiB is an error rather than buffered.
- Exit codes: 0 done or complete, 1 error, 2 bad command line, 3 incomplete
  usage, 4 stalled, 130 interrupted by SIGINT, 143 by SIGTERM (128 plus the signal number).

### `hexagen-orchestration-fix-brief`

OW-D14 fixed sixteen bins; this is the seventeenth (`brief-new` follows it).

```bash
hexagen-orchestration-fix-brief --pr <n> --round <k> --lane <id> \
  --worktree <path> --branch <name> --tip <sha> [--out <path>]
```

Drafts the brief for a fix round in which the lane commits only (Template E in
the orchestrate-wave skill's `references/briefs.md`) from the PR's UNRESOLVED
review threads. It reads them with the same paginated, fail-closed fetch as
`sweep`: a page that cannot be read refuses the whole run (exit 1) rather than
briefing from half a PR.

- `--pr` and `--round` are positive safe integers. `--lane`, `--worktree`,
  `--branch` and `--tip` are written into the brief's header, so each must be a
  single line: any control, format or line-separator character is refused (exit 2),
  before anything is fetched.
- `--out` refuses an existing file (exit 1), checked before the fetch and again
  by an exclusive write. Without it, the brief goes to stdout.
- Review text is quoted as data, in a fence one backtick longer than the longest
  backtick run inside it, and each item closes with
  `— end of quoted text for item N —`. A reviewer's agent-prompt `<details>`
  block (its own first summary reads "Prompt for AI Agents" or "Agent Prompt")
  is replaced by a one-line note of how much was withheld; nested `<details>`
  are handled by a depth-counting scan.
- The orchestrator sets each item's `Disposition:` line and edits the
  Verification section before dispatching the brief.

## Development

```bash
yarn workspace @hexagen/orchestration build
yarn workspace @hexagen/orchestration test
```
