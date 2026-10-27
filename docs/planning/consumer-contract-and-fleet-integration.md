# Plan: a consumer contract for orchestrators (fleet-v2 integration, hexagen side)

- **Date:** 2026-10-25
- **Status:** draft. It was proposed by the fleet-v2 orchestrator session, and this repository's own session owns it, including its lanes and merge.
- **Companion:** `fleet-v2/docs/planning/2026-10-25_hexagen-integration-plan.md` (the fleet-v2 side, lanes F1–F7).
- **Owner decisions (2026-10-25):**
  - **Contract ownership** resides with hexagen-monaco.
  - **Contract changes** most likely start from a fleet-v2 need, arriving as a work order against this repository. A hexagen release then fans out update work orders to every provisioned project that depends on the contract.
  - **Detection:** a hexagen-generated project is identified simply at provisioning, from `.architecture/manifest.yaml`.

## 1. Goal

Make hexagen's existing command-line contract (ADR-0056: the `hexagen` and `hexagen-lint` binaries, with their commands, flags, exit codes and effects on disk) complete enough for an orchestrator to rely on:

- without importing hexagen;
- without running project code to find out what it is looking at;
- surviving a mix of hexagen versions across many projects.

## 2. Gaps found (read-only, 2026-10-25)

- **No generator identity.** The manifest's `generator` block has `version` but no `name`. The block may also live in the side-car named by `workspace_config:` (normally `.architecture/workspace.config.yaml`; see `manifest-merge-loader.ts`), whose `generator` block wins on merge. `.architecture/generator.config.yaml` is runtime state, not the side-car (corrected 2026-10-27; see ADR-0072). An orchestrator cannot tell a hexagen manifest from any other tool's file in `.architecture/`. This repository itself keeps ADRs in `.architecture/decisions/`.
- **`hexagen arch validate` gives human output only,** and uses exit 1 both for "violations" and for "could not run" (`packages/sync/src/commands/arch/validate.ts`). `hexagen-lint` already distinguishes them (0, 1 and 2).
- **`hexagen sync --check`** reports pending operations only as prose on stderr.
- **`hexagen-lint --json`** has no `schemaVersion` field in its output line.
- **No document names the consumer contract** as a whole: which outputs and exit codes consumers may rely on, and the compatibility policy for them.

## 3. Lanes (in this repository)

| Lane | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1   | **Generator identity.** Add `generator.name: "@hexagen-monaco/sync"` to the manifest schema, wherever `generator` is read (root or side-car). `hexagen sync` writes it for new projects, and `hexagen manifest migrate` adds it to existing ones. Absence stays valid (legacy)                                                                                                                                                                                                                                                |
| H2   | **Machine output and exit codes.** `hexagen-lint --json` gains a `schemaVersion` field. `hexagen arch validate --json` prints one JSON line, and exit 2 means "could not run". `hexagen sync --check --json` prints a one-line summary of pending operations. Contract tests go in `packages/sync/__tests__/contract/`                                                                                                                                                                                                        |
| H3   | **The consumer-contract document** (an ADR or a section in ADR-0056). It covers: <br>• the identity marker (H1) and where it lives; <br>• the supported JSON lines and exit codes (H2); <br>• the compatibility policy: additive changes in a minor, breaking changes only with a migration path and a named CHANGELOG entry, with the old behaviour readable for at least one release; <br>• the change-request intake: a consumer need arrives as a work order against this repository and is gated by this repository's CI |
| H4   | _Optional, deferred:_ `hexagen grant issue --from-json`, which accepts a list of paths derived from a brief                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 4. Rules for consumers to rely on (to state in H3)

- **Read files, don't run project code.** A consumer may detect hexagen by reading the manifest and the identity marker. It must not need to run a project's own `hexagen` binary to classify the project.
- **Missing or unknown means not configured.** A consumer treats a missing or unknown hexagen as "not configured", never as a pass.
- **Consumers use only published releases,** exactly pinned: never a branch or a working copy of this repository.

## 5. Assumptions

hexagen keeps its binaries, not the library API, as the supported contract (ADR-0056 Decision 1). Library exports stay provisional under 0.x and are not part of this contract.
