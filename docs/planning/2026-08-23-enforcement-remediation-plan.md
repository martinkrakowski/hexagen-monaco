# Enforcement remediation — implementation plan

**Date:** 2026-08-23
**Source:** `docs/planning/2026-08-23-project-learnings-catalogue.md` (the catalogue); the four-phase programme derived from it
**Predecessor:** `docs/planning/2026-08-20-remaining-work-plan.md` (still the live feature queue; this plan does not replace it)

## Why this exists on its own

The catalogue names one master pattern — **a check that reports success while checking nothing** (AUD-010) — and counts forty-plus instances. Every earlier plan fixed instances. This one targets the conditions that let them recur: records that contradict each other, test files that are never type-checked, CI that runs on a platform and runtime the product does not ship on, and guards that lint paths nothing uses.

The outcome worth stating up front: **most of Phase 2 and Phase 3 as originally worded cannot be built as CI gates.** "Mandate a mutation test" and "codify assert-non-empty" describe practices; a job that claims to enforce them generically would itself be an AUD-010 instance. This plan says which items become gates, which become lint rules with a finite allow-list, and which stay doctrine — and marks the difference rather than promising enforcement that cannot fail.

Every file path, script name and workflow line below was re-verified against the tree on 2026-08-23. Where this plan's inputs were wrong, the correction is recorded inline rather than silently applied.

## 0. Status

| phase | item                                     | verified state 2026-08-23                                                                                                                                                                                                                                                                                                                                 | status                       |
| ----- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1     | ADR-0061 vs ADR-0066 licensing           | Reconciled: preambles, README badge, both ADR statuses, `docs/index.md`. Published tarballs verified through `scripts/prepare-publish-package.js`.                                                                                                                                                                                                        | **done** — #627 (`9d2f627f`) |
| 1     | Duplicate ADR-0009 / ADR-0010            | Two files per number still exist.                                                                                                                                                                                                                                                                                                                         | in flight — #629             |
| 1     | "Superseded" status on outdated records  | Before the Phase 1 PR, 4 ADRs carried a marker (0038 partial, 0049, 0061, 0066-supersedes). The Phase 1 PR (#629) derived the pairs from the ADR texts: **13** (2 full, 7 partial, 4 amendments), both sides now marked. The catalogue's "twenty-six" had no textual basis and is corrected in #628.                                                      | in flight — #629             |
| 1     | ADR-0064 vs ADR-0065 (k8s manifests)     | ADR-0064 has no status line; tree has no `k8s/`.                                                                                                                                                                                                                                                                                                          | in flight — #629             |
| 2     | `typecheck:test` for `apps/web`          | **Correction to the input brief:** 28 packages define `typecheck:test` (every `packages/*` and `tools/arch-linter`), not 5. `apps/web` is the only workspace without it. `apps/web/tsconfig.json:77-83` excludes `**/*.test.ts(x)`; `tsconfig.test.json` only sets `jsx` and inherits the exclusion — `tsc --listFilesOnly` sees **0** of 236 test files. | open                         |
| 2     | "Assert non-empty before clean" codified | Practice only (catalogue §1.1, §8). Nothing enforces it.                                                                                                                                                                                                                                                                                                  | open — needs D-4             |
| 2     | Mutation-test mandate for new gates      | Practice only. No PR template exists (`.github/PULL_REQUEST_TEMPLATE*` absent).                                                                                                                                                                                                                                                                           | open — needs D-5             |
| 3     | Windows CI leg                           | No `windows-latest` in any workflow.                                                                                                                                                                                                                                                                                                                      | open — needs D-1             |
| 3     | `turbo build --force` before test        | **Correction to the input brief:** `--force` is not absent. `sync-integrity.yml:72` runs `turbo run build … --force` as "Verify Build After Sync", deliberately, to prove the synced tree rebuilds from scratch. No job forces a rebuild _before tests_.                                                                                                  | open — needs D-2             |
| 3     | Smoke test inside `node:20-alpine`       | `lint.yml:347-385` `standalone-smoke` runs on `ubuntu-latest` with `setup-node` `20`. Its comment cites the Dockerfile (`FROM node:20-alpine` at lines 2 and 54) but no job runs inside that image. Only `deploy.yml` builds it, and it ships rather than validates.                                                                                      | open — needs D-3             |
| 4     | Delete the 20 `export {};` barrels       | Exactly 20 across 11 packages (list in P4.1). ADR-0050 §1 already authorises retirement.                                                                                                                                                                                                                                                                  | open                         |
| 4     | Purge dangling layer-rules path          | `.architecture/invariants/layer-rules.yaml:86` lists slice `apps/web/features/llm-driver/`, which does not exist. `packages/llm-driver` _does_ exist — the dangling entry is the web feature slice, not the package. `driver_slice_exceptions` has **zero consumers** in `tools/arch-linter/src`, `packages/sync/src`, `scripts/`.                        | open                         |
| 4     | "Step Zero: Liveness" checklist          | Described in the catalogue §3.1; absent from `AGENTS.md`.                                                                                                                                                                                                                                                                                                 | open                         |

## 1. Packets

Sizes: S ≤ half a day, M ≤ two days, L more. Every exit criterion names the fault that must turn the gate red — a gate that has not been shown to fail has not been shown to exist.

### Phase 2 — anti-vacuity and type safety

**P2.1 — `apps/web` test sources type-checked** · **M** · no dependencies

- _What:_ add `typecheck:test` to `apps/web/package.json` (`tsc -p tsconfig.test.json --noEmit`), and make `tsconfig.test.json` actually include `**/*.test.ts(x)` — it must override the parent's `exclude`, since `extends` inherits it. Turbo's `typecheck:test` task and the `sync-integrity.yml` step already fan out to every workspace that defines the script, so no workflow edit is needed.
- _Why:_ catalogue §1.4 — #460, #486, #513, #595, #616. `#595`: a required prop was added, a test broke invisibly, `yarn typecheck` reported 0. Fixing the apps/web gap in #486's sibling (`governance`) surfaced nine real errors; expect the same order here.
- _Exit:_ (a) `tsc --listFilesOnly -p apps/web/tsconfig.test.json | grep -c '\.test\.tsx\?$'` equals the `find` count (236 today), asserted in a test so the include cannot silently regress; (b) **mutation:** rename one prop on a component under test, run `yarn turbo run typecheck:test --filter=web`, expect non-zero; revert; (c) the errors the new check surfaces are fixed in the same PR or listed in its body with a reason — not excluded.
- _Risk:_ the first run will be red. Budget the M for fixing what it finds, not for the config.

**P2.2 — population-guard lint rule** · **M** · depends on D-4

- _What:_ an ESLint rule in `packages/eslint-plugin-ui` (the repo's existing custom-rule home) that flags a negative-shape assertion — `expect(x).not.toContain`, `.not.toHaveLength(0)`-style absence checks, `toEqual([])` on a filtered result — when no positive length/size assertion on the same identifier precedes it in the same test body. Allow-list by comment (`// population-guard: <reason>`), never by path.
- _Why:_ catalogue §1.1 — #421, #478, #499–#501, #518, #595, #570, #616 (×2), #626. The pattern has recurred in ten PRs across four arcs; a reminder has not worked.
- _Honesty clause:_ this rule catches the **syntactic** shape only. It cannot see that a population was empty at runtime, cannot follow a helper that asserts on the caller's behalf, and will produce false positives on legitimately-empty expectations. It is a tripwire, not a proof. Its value is that it makes the author write the guard or write the reason.
- _Exit:_ (a) rule ships with its own fixture suite — positive cases that must flag, negative cases that must not; (b) **mutation:** delete a `length > 0` guard from one existing test, run lint, expect the rule to fire; (c) the initial sweep over the tree is reported as a count in the PR body, with every allow-list comment reviewed.
- _If D-4 lands as "doctrine only":_ this packet collapses to an `AGENTS.md` paragraph and a PR-Agent instruction (see P2.3). Say so in the PR rather than shipping a rule that is immediately allow-listed everywhere.

**P2.3 — mutation-test mandate** · **S** · depends on D-5

- _What:_ two deliverables, neither a CI job. (1) `.github/PULL_REQUEST_TEMPLATE.md` with a required section: _"Gates added or changed in this PR, and the fault each was shown to fail on (command + exit code)."_ (2) A paragraph in `.pr_agent.toml`'s `extra_instructions` (currently at lines 116 and 153) briefing the reviewer to refuse any new CI step, test assertion, or guard whose PR body does not name the injected fault — and to check that the named fault actually exercises the gate.
- _Why:_ catalogue §0 and §3.2. #625's failure guard (`--raw-field` switched `gh api` to POST; the check could never fail), #595's route ratchet that compared two constants, #616's `for` over an emptied list. Each shipped green and was caught by a reviewer or not at all.
- _Why not a CI job:_ there is no general way for a job to know what fault a new gate is meant to catch. A job that greps the PR body for the word "mutation" is the pattern this plan exists to end.
- _Exit:_ the template exists and renders; the PR-Agent brief change is verified by opening a PR that adds a trivially vacuous assertion and observing the bot flag it. That verification PR is closed, not merged.

### Phase 3 — CI realism

**P3.1 — Windows leg** · **M (scoped) / L (full)** · depends on D-1

- _What (default, scoped):_ a `windows-latest` matrix entry in `sync-integrity.yml` that installs and runs the test suites of `packages/sync` and `tools/arch-linter` only — the two packages where every catalogue §2.3 defect lived. Not the web app: `apps/web` depends on `better-sqlite3` (`apps/web/package.json`), whose native build on Windows runners is a separate cost with no §2.3 defect behind it.
- _Why:_ catalogue §2.3 — #466 (ts-morph forward slashes vs native input classified every file as unknown), #458 (fast-glob ignores `\`), #545 (`..\..\outside.txt` escaped a containment check). All three shipped green on ubuntu.
- _Exit:_ (a) the leg is **required** in branch protection, or it is decoration; (b) **mutation:** revert #545's `isContainedRelativePath` fix on a throwaway branch and confirm the Windows leg alone goes red; (c) wall-clock recorded in the PR body so D-1 can be revisited with a number.
- _Known hazard:_ husky's `sh -e` shim (#567) and Yarn 4 on Windows runners. Budget a day for the runner, not the tests.

**P3.2 — fresh-build guarantee before tests** · **S** · depends on D-2

- _What (default):_ **do not** add a blanket `--force`. Instead: (1) audit `turbo.json` task `inputs` for every `build` and `test` task so the cache key includes everything the output depends on — the catalogue's stale-`dist` cases were all _missing edges_ (#616 subprocess dependency, #465 `lint` never reaching arch-linter, #452 bin shim), not cache-hash collisions; (2) keep the existing `--force` at `sync-integrity.yml:72` where it has a stated purpose.
- _Why the original wording is wrong for CI:_ CI checks out a fresh tree; the stale-`dist` defect is a **local worktree** problem (catalogue §2.1 practice line, §2.2). A forced rebuild on every PR buys nothing there and costs the full build — the `sync-integrity` run on main today took ~11.5 min cached; forced it is the whole graph.
- _Exit:_ (a) a test in `packages/sync/__tests__/` or a script under `scripts/` that parses `turbo.json` and asserts every task with `dependsOn: ["^build"]` also lists its consumed `dist` paths in `inputs` of the consumer — with a **mutation** that removes one input and expects the check to fail; (b) the `AGENTS.md` "Commands After Edits" section names `yarn turbo build --filter=<pkg> --force` as the local rule — that is where the defect lives.

**P3.3 — smoke test inside the production image** · **M** · depends on D-3

- _What (default, supplement):_ a second job in `lint.yml` that builds `apps/web/Dockerfile` with `docker build --target runner`, then runs `scripts/verify-standalone-scan.mjs` _inside_ the container via `docker run`. The existing `standalone-smoke` job stays: it is fast and catches artifact-shape defects on every push; the container job catches runtime/OS ones.
- _Why:_ catalogue §4.1 and §2.3 — #616 ran the artifact on Node 22 while the image runs 20 and two bots caught it independently; the D-P1 arc found the tracer copies files not symlinks and the image lacked `.architecture/manifest.yaml`, visible only by `docker exec`. The current job's comment says it "matches node:20-alpine"; matching the Node major on glibc Ubuntu is not the same as running on musl Alpine.
- _Exit:_ (a) the job asserts `collected: true` and `filesScanned >= 1` from inside the container — the same non-vacuous shape D-P1 used; (b) **mutation:** remove `manifest.yaml` from `outputFileTracingIncludes` on a throwaway branch and confirm only the container job goes red; (c) image build time recorded; if it exceeds ~6 min, cache layers with `actions/cache` keyed on the lockfile before declaring the job required.

### Phase 4 — liveness and phantom-code purge

**P4.1 — delete the 20 empty barrels** · **S** · no dependencies

- _What:_ remove the 20 `export {};` files (deployment ×3, external-integration, layout-engine, manifest-generation ×2, mcp-server, messaging, model-settings ×3, monaco-orchestration, persistence ×3, ui ×3, wizard-orchestration) and any `package.json` `exports` / barrel re-export that names them. Zero-consumers scout per file in the PR body, per the repo's existing deletion discipline (catalogue §5.5).
- _Why:_ ADR-0050 §1 retired the convention in principle; the generator no longer emits them. The 20 that remain are the pre-ADR residue and they are lint surface with nothing behind it. Note ADR-0050 §3's carve-out: `core-domain` and `runtime` were to be handled by relocating real code — neither appears in today's list of 20, so that decision is already discharged or moot; say which in the PR.
- _Exit:_ `grep -rlx "export {};" --include=index.ts packages apps tools | wc -l` is 0, asserted in a test so the count cannot creep back; `turbo build` and `typecheck` green; **the sync engine run in `--strict` mode does not regenerate them** — if it does, the generator still has an emitter and this packet has found a bug, not finished.

**P4.2 — dangling `layer-rules.yaml` slice** · **S** · no dependencies

- _What:_ delete the `driver_slice_exceptions` entry at `.architecture/invariants/layer-rules.yaml:85-92` for `apps/web/features/llm-driver/`. Then decide the block: it has no consumer in the linter, sync engine, or scripts, so either wire it (the AR-9 comment says it is an "accepted exception", but nothing reads the acceptance) or delete the whole key and move the prose to the ADR that owns AR-9.
- _Why:_ catalogue §2.5 "dead config does not announce itself" and §9. A rule file that lists a path that does not exist, read by nothing, is two defects. Default here is **delete the key**; a consumer can be added back when a rule actually needs the list.
- _Exit:_ the linter's YAML loader rejects unknown top-level keys, **or** a test asserts every `slice:` path in the file exists on disk — with a mutation that adds a bogus path and expects failure. Without one of those this file drifts again.

**P4.3 — "Step Zero: Liveness" in `AGENTS.md`** · **S** · no dependencies

- _What:_ a short mandatory section under "Before Every Exchange" (`AGENTS.md:18`): before hardening, refactoring or guarding any code path, prove it is live — a route that renders it, a test that imports it, a CLI that reaches it, or a consumer grep that returns non-zero — and put the proof in the PR body. "No consumers" is a deletion finding, not a hardening target.
- _Why:_ catalogue §3.1 and §6. The brownfield arc spent packets hardening a scan route before verifying the route dispatched; D-P1 option A was designed against a tracer behaviour that was never checked; the AR-9 exception above guards a directory that does not exist.
- _Exit:_ the section exists; the PR-Agent brief (P2.3) cites it so the bot asks for the proof. No CI gate — this is a checklist and should be called one.

## 2. Decisions

| id      | question                                                                        | default if unanswered                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-1** | Windows leg scope: full matrix, or `packages/sync` + `tools/arch-linter` only?  | **Scoped.** That is where every §2.3 defect lived. `apps/web` brings `better-sqlite3`'s native build for no known defect. Revisit with P3.1's recorded wall-clock.                                                                                                                                                                                                                                                                                                                    |
| **D-2** | `turbo build --force` before tests?                                             | **No.** Reframe as cache-input correctness (P3.2). A blanket force defeats the cache on every PR for a defect that lives in local worktrees. Keep the single existing `--force` at `sync-integrity.yml:72`, which has a stated purpose.                                                                                                                                                                                                                                               |
| **D-3** | Alpine container job: replace `standalone-smoke`, or supplement it?             | **Supplement.** The existing job is fast and catches artifact shape. The container job is slower and catches runtime. If the container job proves cheap (< ~6 min with layer cache), revisit replacement.                                                                                                                                                                                                                                                                             |
| **D-4** | "Assert non-empty" — ESLint rule with allow-list, or `AGENTS.md` doctrine only? | **Rule, with the honesty clause in P2.2 written into the rule's docs.** Ten recurrences say doctrine alone has failed. But if the first sweep produces more allow-list comments than fixes, that is evidence the rule is noise — downgrade to doctrine and say so.                                                                                                                                                                                                                    |
| **D-5** | Mutation-test mandate — PR template + reviewer brief, or a CI job?              | **Template + brief.** A CI job cannot know what fault a new gate targets. Any job that claims to would be the AUD-010 pattern with a new name.                                                                                                                                                                                                                                                                                                                                        |
| **D-6** | Branch protection — make the new legs required?                                 | **Yes for P2.1 and P3.1; P3.3 after its timing is known.** Verified 2026-08-23 via `gh api`: classic branch protection on `main` is off (404), but an active ruleset `main-ruleset` exists with rules `deletion`, `copilot_code_review`, `required_deployments` — and **no `required_status_checks`**. So today no CI leg gates a merge. "Required" here means adding a `required_status_checks` rule to that ruleset, not creating protection from scratch. Owner setting, not a PR. |

## 3. Sequencing

```
Phase 1 PR (in flight)
      │
      ├──▶ P4.3 AGENTS.md liveness ──▶ P2.3 template + bot brief ◀── D-5
      │
      ├──▶ P2.1 apps/web typecheck:test           (independent, start now)
      ├──▶ P4.1 empty barrels                      (independent, start now)
      ├──▶ P4.2 layer-rules slice                  (independent, start now)
      │
      ├──▶ D-4 ──▶ P2.2 population-guard rule
      ├──▶ D-1 ──▶ P3.1 Windows leg ──┐
      ├──▶ D-2 ──▶ P3.2 cache inputs  ├──▶ D-6 branch protection (owner)
      └──▶ D-3 ──▶ P3.3 alpine job ───┘
```

**Parallel-safe delegation:** P2.1, P4.1, P4.2 touch disjoint paths and can run as three workers at once. P3.1 and P3.3 both edit workflow YAML — serialise them or give each its own file. P2.2 and P2.3 both touch reviewer-facing surfaces; land P2.3 first so the bot can review P2.2.

**Worker constraints** (from catalogue §2.2): a worktree-delegated worker has no `node_modules`; every "tests green" claim from a worker is unverified until the primary runs it. Workers edit and report; the primary commits, pushes and opens PRs.

## 4. What this plan does not do

| excluded                                             | why                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feature work from the 2026-08-20 remaining-work plan | That queue is unchanged. This plan is enforcement only.                                                                                          |
| Fixing the errors P2.1 surfaces beyond the same PR   | If the count is large, the PR lists them with reasons and a follow-up packet is opened. Excluding files to get green is the pattern being ended. |
| A generic "vacuity detector"                         | Does not exist. P2.2 is a syntactic tripwire and says so.                                                                                        |
| Wiring `driver_slice_exceptions` into the linter     | Default is deletion (P4.2). Wiring is a new rule with its own design.                                                                            |
| Re-running the ADR supersession sweep                | Done in #629 (13 pairs from the texts); this plan records the result.                                                                            |
| Replacing `standalone-smoke`                         | Supplement by default (D-3).                                                                                                                     |

## 5. Risks

| risk                                                       | mitigation                                                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2.1 first run surfaces dozens of errors and the PR stalls | Size M includes the fixes. If > ~40, split: config + first half in PR 1 with the rest listed; never `exclude`.                                              |
| P2.2 rule is mostly allow-listed → noise                   | D-4's explicit downgrade condition; report the fix:allow ratio in the PR body.                                                                              |
| Windows runner cost/flake eats the arc                     | D-1 scoped default; one-day budget for the runner; if exceeded, land the leg as non-required and record why, rather than silently dropping it.              |
| Container job too slow to be required                      | Layer cache; record timing; D-3 revisit. A slow optional job still catches #616-class defects on main.                                                      |
| Deleting barrels breaks a published `exports` map          | Zero-consumers scout per file; run `scripts/prepare-publish-package.js` for `packages/sync` and `tools/arch-linter` in the PR and diff the staged manifest. |
| A worker "verifies" without `node_modules`                 | Primary re-runs every command a worker reports; the PR body carries the primary's output, not the worker's.                                                 |
| New gates pass on day one without ever having failed       | Every exit criterion above names its mutation. A PR that cannot show the red run is not done.                                                               |

## 6. Ready when

- Phase 1 PR merged; `docs/index.md` status column agrees with every ADR's own status line (assert with a script, not by eye).
- `yarn turbo run typecheck:test` covers `apps/web` and CI goes red on a deliberately broken test-file type.
- D-1…D-6 each have an answer recorded in this document's table, or the default has been explicitly accepted.
- Every new gate's PR body contains the command that made it fail and the exit code.
- The `export {};` count is 0 and `layer-rules.yaml` names only paths that exist, both asserted by tests with recorded mutations.
