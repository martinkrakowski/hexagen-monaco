# @hexagen/orchestration

Wave orchestration tooling for a HexaGen project, packaged as command-line
bins (the table below lists them all).

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

OW-D14 fixed sixteen bins; this is the seventeenth.

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
