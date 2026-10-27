# ADR-0072: The Consumer Contract — Generator Identity, Machine Output and Exit Codes

**Date:** 2026-10-27
**Status:** Proposed
**Type:** Release / Public API
**Relates to:** ADR-0056 (the published contract is the binary — this ADR names what that binary promises an orchestrator), ADR-0054 (arch-lint enforcement posture — the source of the findings counted in the JSON line), ADR-0057 (manifest layer lists are a curated ownership registry)

> This is lane **H3** of `docs/planning/consumer-contract-and-fleet-integration.md`.
> Lanes H1 (generator identity) and H2a/H2b (machine output and exit codes)
> implement it; this ADR records the decision they rely on and must merge before
> the H2a exit-code change ships.

## Context

ADR-0056 established that the published contract of `@hexagen-monaco/sync` and
`@hexagen-monaco/arch-linter` is the **binary**: the `hexagen` and `hexagen-lint`
commands, their flags, exit codes and effects on disk. It did not say which of
those an outside program may rely on, or how they may change.

An orchestrator (fleet-v2 is the first) now needs exactly that. It must:

1. **Recognise a Hexagen-generated project without running it.** Its onboarding
   probe reads files only and never executes project code.
2. **Tell "the code breaks the rules" from "nothing was checked".** Today
   `hexagen arch validate` exits 1 for both a violation and a check that could
   not run (a malformed manifest, a missing or crashed linter, a timeout). A
   gate that sees `1` cannot tell them apart, so a check that ran nothing can
   look like an ordinary failure — or, in a caller that treats any non-zero as
   "has findings", be misreported.
3. **Survive a mix of Hexagen versions** across many projects, each with its
   own exact pin.

Contract ownership stays here (owner, 2026-10-25): an orchestrator that needs a
change asks for it as a work order against this repository, gated by this
repository's CI. It never forks the behaviour.

## Decision

### 1. Generator identity (H1)

A Hexagen-generated project declares
`generator.name: "@hexagen-monaco/sync"` in its manifest.

- **Where it is read:** the root `.architecture/manifest.yaml` `generator`
  block, and — for a split manifest — the side-car file named by
  `workspace_config:` (normally `.architecture/workspace.config.yaml`), whose
  `generator` block wins on merge. `.architecture/generator.config.yaml` is
  runtime state, not the side-car, and is never the place to look.
- **Who writes it:** `hexagen sync` when it creates a manifest for a new
  project, `hexagen bootstrap` (brownfield adoption), and
  `hexagen manifest migrate` for existing projects. `migrate` never overwrites a
  different existing `generator.name`; it refuses and names both values.
- **Absence stays valid.** A manifest without `generator.name` is a legacy
  Hexagen project or not a Hexagen project; consumers must treat absence as
  "unknown", never as "not Hexagen" proof.
- The value is the **published** package name, even though the workspace package
  is `@hexagen/sync` until publish.

### 2. Exit codes

Every command an orchestrator may call uses one meaning per exit code:

| Exit | Meaning                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------- |
| `0`  | Ran, and the result is clean (compliant / converged)                                                      |
| `1`  | Ran, and found something (violations / drift)                                                             |
| `2`  | **Could not run**: usage error, malformed manifest, missing or crashed linter, timeout, unreadable output |

`hexagen arch validate` adopts this in H2a: a broken manifest moves from exit 1
to **exit 2**. `hexagen-lint` already follows it. `hexagen sync --check` keeps
0/1 for now (H2b); its JSON `status` field distinguishes "could not run"
(`could-not-run`) from drift. Moving `sync --check` to exit 2 is a separate,
later decision under §4.

### 3. Machine output

A command run with `--json` prints **exactly one JSON line on stdout**, and every
log line goes to stderr.

- Every JSON line carries `"schemaVersion": <integer>` as its first key,
  starting at `1`, and a `"command"` naming the command.
- `hexagen-lint --json`: `{schemaVersion, fresh, baselined, stale, expired,
introduced, baselineGrowth, filesScanned}`. On exit 2 no line is promised.
- `hexagen arch validate --json` (H2a): `{schemaVersion, command: "arch validate",
status, exitCode, fresh, expired, baselineGrowth, filesScanned, reason}`, with
  `status` one of `compliant`, `violations`, `could-not-run`.
- `hexagen sync --check --json` (H2b): `{schemaVersion, command: "sync --check",
status, exitCode, pending: {created, updated, deleted, total}, errors,
manifestMissing, reason}`, with `status` one of `converged`, `drift`,
  `could-not-run`.

Human-readable output is unchanged and is **not** part of the contract.

### 4. Compatibility policy

- **Additive changes ship in a minor release:** a new key in a JSON line, a new
  flag, a new `status` value documented as such. Consumers must ignore unknown
  keys.
- **Breaking changes** (removing or renaming a key, changing a key's meaning,
  changing an exit code's meaning, changing where the identity marker is read)
  ship only with a migration path and a named `CHANGELOG.md` entry in **bold**,
  bump `schemaVersion` when they touch a JSON line, and keep the old behaviour
  readable for at least one release where that is possible.
- The H2a move of a broken manifest from exit 1 to exit 2 is recorded as such a
  change: a caller that tests only "non-zero" is unaffected; a caller that tests
  `== 1` sees `2` for a check that could not run.
- Under 0.x every such release is a **minor** bump (ADR-0056's rule that `^0.y.z`
  must not auto-adopt behaviour changes). The first release carrying §1–§3 is
  **0.15.0** (owner, 2026-10-27).

### 5. Change requests from consumers

A consumer that needs the contract to change opens a work order against this
repository. The change lands here, behind this repository's CI and contract
suites, and reaches consumers only through a published release and their own
exact-pin bump. No consumer patches, wraps or re-implements a Hexagen command to
get different behaviour.

## Consequences

- **Orchestrators can gate on Hexagen honestly.** Exit 2 and `status:
could-not-run` let a gate record "unknown" instead of "failed" or "passed".
- **The identity marker makes provisioning decisions file-only.** A probe reads
  two YAML files and never runs project code.
- **Every JSON line is versioned,** so consumers on different pins can parse what
  they understand and ignore the rest.
- **One behaviour change ships in 0.15.0** (the exit-2 move). Generated projects'
  `lint:arch` script runs `hexagen arch validate`, so a project with a broken
  manifest now fails `lint:arch` with 2 instead of 1. CI that checks non-zero is
  unaffected.
- **`validateManifest` loses its only CLI caller** after H2a and stays exported,
  because removing a barrel export is itself a minor-release change; its removal
  is left to a later release.

## Alternatives considered

- **Keep exit 1 for everything and rely on JSON `status`.** Rejected: most
  callers read the exit code first, and exit 1 for "could not run" is exactly the
  ambiguity this ADR removes.
- **Detect a Hexagen project by its `node_modules` or by running `hexagen`.**
  Rejected: an onboarding probe must not execute project code, and installed
  modules are not a declaration.
- **Consumers adapt by wrapping the binaries.** Rejected: it forks the
  behaviour per consumer and moves contract ownership out of this repository.
