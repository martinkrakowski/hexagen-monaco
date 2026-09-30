# @hexagen/orchestration

Wave orchestration tooling for a HexaGen project, packaged as sixteen
command-line bins.

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
`opencode-server`, and reports a deprecation, which `doctor` prints as a `WARN`.
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
| `hexagen-orchestration-merge-prs`        | Merge ready pull requests                           |
| `hexagen-orchestration-verify-manifests` | Verify mutation manifests                           |
| `hexagen-orchestration-mutate`           | Replay mutations                                    |
| `hexagen-orchestration-mutate-verify`    | Verify a replayed manifest                          |
| `hexagen-orchestration-mutate-anchors`   | Verify a manifest's anchors                         |
| `hexagen-orchestration-init`             | Scaffold the project's overlay                      |
| `hexagen-orchestration-doctor`           | Validate the overlay and the project's capabilities |

## Development

```bash
yarn workspace @hexagen/orchestration build
yarn workspace @hexagen/orchestration test
```
