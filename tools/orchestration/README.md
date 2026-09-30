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
exists) alongside `house-rules.md`, `cast.md` and `lessons.md`.
`hexagen-orchestration-doctor` validates it and reports anything the project is
missing.

Nothing in the package hardcodes a repository, a port or a log root — every one
of those comes from the overlay, so the same package serves any project that
adopts it.

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
