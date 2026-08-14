# Architecture remediation plan

**Date:** 2026-08-14 · **Status:** proposed
**Baseline:** `main` @ `7b2c7248`

## Source material and how this plan differs from the review's backlog

This plan supersedes the root-level review deliverables produced on 2026-08-13
(`ARCHITECTURE-REVIEW.md`, `BACKLOG.md`, `ADR-CANDIDATES.md`, `COVERAGE.md`,
`findings.json`, `inventory.json`). Those files were adversarially audited on
2026-08-14 (76-agent workflow; 43/64 findings confirmed, 21 overstated, 0 refuted;
45 severities lowered including all three criticals; 10 recommendations unsound;
22 material findings missed). The six review files have been **archived, not
deleted**, to `docs/planning/2026-08-13-architecture-review/`, alongside the audit
record that grounds every deviation below:

> `docs/planning/2026-08-13-architecture-review/AUDIT-2026-08-14.md`

This plan is built from the **audited** picture, which changes four things:

1. **A new front-of-queue wave.** Seven findings the review missed (AUD-001…003,
   AUD-010/011, AUD-018/019) grade _higher_ than anything that survived the audit.
   Production triage and enforcement come before boundary remediation.
2. **Enforcement before remediation.** The arch-linter cannot see the violation
   classes this plan fixes (AUD-011) and CI never fails on the ones it can see
   (AUD-010, AUD-019). Fixing boundaries before fixing the fence guarantees
   regression.
3. **Deletion replaces renaming.** The port-homonym cluster (HEX-005/006/007), the
   phantom GitOps surface (GOD-006), `getActiveBackend` (HEX-023), and the
   external-integration auth hexagon (AUD-008/009) are dead code. The audit replaced
   ten unsound recommendations — mostly rename/abstract/relocate — with deletions.
4. **A repaired dependency graph.** The backlog's "topological order" contained a
   cross-wave violation (2.4 before 3.2), a genuine cycle (6.3↔6.6), and five items
   that break its own PR-size rule. §Appendix C maps every old item to its new home.

Severities cited below are **post-audit**. Post-audit distribution across all 86
work-relevant findings: 0 critical · 12 high (5 review + 7 missed) · 56 medium ·
18 low.

---

## Execution model: sub-agent delegation

Work is delegated per AGENTS.md **Orchestrator Mode** (`.agents/ORCHESTRATOR.md`):
decompose → work plan → delegate → gate; the orchestrator writes no implementation
code. The role names below extend the spec's sub-agent taxonomy (§Sub-Agent Roles)
with **deliberately widened scopes for this arc**: the spec hard-scopes Domain
Workers to `src/domain/` and Adapter Workers to `src/infrastructure/`, while this
plan also covers ADR docs, CI workflows, `tools/`, and `apps/web` — the widening is
an intentional amendment, not an oversight. **Scout** and **Refuter** are roles this
plan defines (Scout = the spec's `explore`-shape read-only agent; Refuter = parallel
general agents), not existing repo roles:

| Role               | Used for                                            | Agent shape                                              |
| ------------------ | --------------------------------------------------- | -------------------------------------------------------- |
| **Scout**          | Pre-flight liveness/impact checks                   | Read-only `Explore` agent; no edits                      |
| **Domain Worker**  | Domain/application-layer moves, use-case extraction | `general-purpose` agent in an isolated worktree          |
| **Adapter Worker** | Adapters, routes, composition roots, CI workflows   | `general-purpose` agent in an isolated worktree          |
| **Test/QA Worker** | Regression + contract tests, gate runs              | `general-purpose` agent; may share the item worktree     |
| **Refuter**        | Adversarial verification of risky claims/diffs      | 2–3 parallel agents prompted to refute, majority verdict |

Standing rules for every delegated item:

- **One item = one delegation unit; each PR = one worktree.** Most items are a
  single PR. An item MAY enumerate a fixed, addressable set of sub-PRs — lettered
  `X.Y(a)/(b)/(c)`, one per package, tool family, or leftover finding — and each
  sub-PR is then its own worktree and PR. No two items (or sub-PRs) share a
  checkout. An unbounded "~N PRs" is not allowed: the enumeration must be
  explicit so delegation/merge status is trackable per sub-PR. Item IDs stay
  stable so Appendix A finding traceability holds. Parallel items/sub-PRs get
  parallel worktrees (`isolation: worktree`); worktrees lack `node_modules` —
  run gates from the main checkout or install first.
- **Scout before seam edits.** Any item touching a public API, cross-package
  boundary, or injection point gets a scout pass verifying the code path is live
  (or dead, for deletion items) _before_ the worker starts. Deletion items require
  a zero-consumers proof (grep + typecheck) recorded in the PR body.
- **Gates between dependent items.** A dependent item does not start until its
  prerequisite is merged and the repo's gate commands are green on main:
  `yarn build && yarn typecheck && yarn lint && yarn test`, plus `yarn lint:arch`
  (the Quality Gate) for any item that touched ports, adapters, or manifests.
  Independent items within a wave fan out concurrently.
- **Primary-reserved tasks stay reserved.** Per `.agents/ORCHESTRATOR.md`, workers
  never edit `.architecture/manifest.yaml` or the context YAML family, never run
  `yarn lint:arch`/the Quality Gate as the gate of record, never `git commit`, and
  never resolve port-ownership conflicts. Workers **stage proposals** (draft YAML
  diffs, staged code changes); the Primary applies manifest-family edits, runs the
  gates, and commits. Items that add/move/rename ports (5.1, 5.4, 6.4, 6.5, 4.1,
  4.4) are therefore worker-prepared, Primary-landed.
- **Verification fan-out for risky waves.** Wave 1 (prod behavior) and Wave 7
  (wire protocol) add a refuter panel on each PR before review: agents attempt to
  demonstrate the bug still reproduces / the protocol drifted. Majority-refuted
  diffs go back to the worker.
- **Bot adjudication per `.agents/REVIEW.md`**: verify every CodeRabbit/qodo
  finding against the code before accepting or refuting; pre-empt known-flaggable
  patterns with inline comments.
- **Effort tiering:** mechanical deletions and config edits → low-effort workers;
  seam changes, saga extraction, protocol work → standard workers + refuters.

Per-wave orchestration is listed in each wave under **Delegation**.

---

## Decision notes (flagged for additional consideration)

Choices this plan does not make unilaterally. Each blocks only its own item.

- **D1 — Gate for the architecture-modify family (blocks 1.3).** Options: NextAuth
  session requirement; shared-secret header for same-host tooling; same-origin +
  rate limit only. The prod container currently runs auth-less flows, so a session
  requirement changes product behavior.
- **D2 — BYOK persistence backend (blocks 1.4).** better-sqlite3 is the de facto
  repo standard; confirm before adding a volume-backed store for
  revocations/metadata/audit.
- **D3 — api-gateway fate (blocks 4.5).** Delete (recommended: stub app, fabricated
  test signal) vs wire it. HEX-033.
- **D4 — Coverage posture (blocks 8.11).** Adopt per-package vitest coverage on a
  ratchet, or delete the dead root c8 script and drop the 80% claim.
- **D5 — TypeScript 6 upgrade (no blocker).** C6's only surviving question. If
  wanted, schedule as its own arc with `requires_toolchain_raise`; Wave 3 deletes
  the stray pin regardless.
- **D6 — sync publish-surface trim semver (blocks 4.7).** Removing
  `InMemoryConfigDouble`/adapters/fs-utils from the published barrel is breaking
  for anyone importing them; fold into the next minor release. Release-gated.

---

## Wave 0 — Decisions (ADRs; docs only)

ADRs live in `.architecture/decisions/`. Numbering starts at **ADR-0047** (0009 and
0010 both have collisions; do not reuse). Assign numbers sequentially at merge time.
Candidates C1–C8 are in the archive; the audit's corrections are binding:

| #   | Item                                  | Source | Findings                          | Audit corrections to apply                                                                                                                                                                                                    |
| --- | ------------------------------------- | ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | Port ownership & homonym doctrine     | C1     | HEX-005/006/007, HEX-002, HEX-014 | Rewrite around **dead-copy deletion** (Wave 4), not import-the-owner; regenerate the 166/7 tallies from the tree (not reproducible as written); keep the write-port guidance for HEX-002/014                                  |
| 0.2 | Inbound/outbound directory convention | C2     | HEX-018, HEX-019                  | Must **formally supersede/amend ADR-0010** (which decided ports/out-only + handlers-delegate-to-use-cases for mcp-server); fix the workspace.config.yaml misattribution                                                       |
| 0.3 | Security bounded-context fate         | C3     | HEX-009, MOD-005                  | As drafted; both options remain live                                                                                                                                                                                          |
| 0.4 | Empty barrels & frozen scaffolds      | C4     | HEX-025, HEX-035                  | Must **formally supersede ADR-0007's Implementation** (`export {};` barrels were a decided convention, not drift); coordinate with ADR-0026                                                                                   |
| 0.5 | LLM catalog ownership                 | C5     | HEX-012, HEX-017                  | Scope HEX-020 down to the subscriber extraction; the env-derived chain stays in the composition root                                                                                                                          |
| 0.6 | Published `engines.node`              | C7     | MOD-004                           | As drafted                                                                                                                                                                                                                    |
| 0.7 | Generated customer error unions       | C8     | HEX-001, HEX-036                  | As drafted                                                                                                                                                                                                                    |
| 0.8 | **Enforcement posture** (new)         | audit  | AUD-010/011/019                   | Strict-vs-ratchet CI lint semantics, layer-rule coverage (relative imports, builtins, npm deps in domain/application), and what generated projects inherit — this changes the published linter's contract, so it needs an ADR |

C6 is **not** an ADR: the pin deletion is executed directly in 3.1; the TS-6 question
is D5.

**Delegation:** one Domain Worker per ADR draft (parallel), each fed the candidate
text + the audit corrections; a refuter panel fact-checks every draft's claims
against the tree before the PR (the ADR-0046 protocol — it caught 3 wrong claims of
26 pre-PR). One PR per ADR or one batched docs PR; squash-merge.

---

## Wave 1 — Production triage (no ADR dependencies; start immediately)

The audit's missed production findings — its three highs (1.1–1.3) plus three
mediums in the same seams. All independent of each other except as noted.

| #   | Findings         | Item                                                                                                                                                                                         | Acceptance                                                                                                                                                        |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | AUD-001 (high)   | Fix `getModifyArchitectureUseCase` singleton cache: never cache the callback/signal-wired instance (`wire.server.ts:569-570,613-615`)                                                        | Regression test: stream request then plain request → plain request gets a fresh, un-aborted instance; doc comment now true                                        |
| 1.2 | AUD-002 (high)   | One manifest-path anchor: routes resolve/validate against `findMonorepoRoot()`; mutation adapter honors (or explicitly drops) its path parameter; `restoreFromGit` targets the real pathspec | Integration test: accept-with-lint-failure restores the manifest and rolls back; reject reaches `transactionManager.rollback`; no transaction stuck `speculative` |
| 1.3 | AUD-003 (high)   | Gate the modify + governance route families per **D1**; remove wildcard CORS; single shared gate helper (no per-route hand-picking)                                                          | Anonymous cross-origin POST can no longer mutate the manifest or spawn subprocesses; posture consistent across the family                                         |
| 1.4 | AUD-007 (medium) | BYOK revocation/metadata/audit onto durable adapters per **D2**                                                                                                                              | Revoke → restart → key still revoked; audit entries survive restart                                                                                               |
| 1.5 | AUD-006 (medium) | Replace both hand-rolled Map limiters with `lib/rate-limiter.ts`                                                                                                                             | No module-level `Map<string, number[]>` limiters; keys hashed; eviction active                                                                                    |
| 1.6 | AUD-005 (medium) | Collapse the governance shadow-rules triplication onto one implementation behind a port; YAML parse failure → explicit non-compliant/error, never `isCompliant: true`                        | `status` and `refresh` agree on the same manifest; one violations source of truth; parse-failure test                                                             |

Ordering: 1.2 before 1.6 (both touch governance/modify plumbing); 1.3 and 1.5 may
share a PR if convenient. 1.6 is the correctness half of HEX-016; the structural
half (ports for shell/FS/LLM) lands in 6.3.

**Delegation:** scouts first on 1.1/1.2 to reproduce the bugs (failing test before
fix); Adapter Workers per item in parallel worktrees; refuter panel on every PR
(attempt to re-trigger stale-callback leak, broken compensation, anonymous
mutation). Test/QA Worker adds the saga integration test harness used again by 6.1.

---

## Wave 2 — Make enforcement real (before any boundary remediation)

Rationale: every later wave's fixes are unprotected until the fence works. Strictness
must land as a **ratchet**: the engine fixes (2.2) will surface the very violations
Waves 5–8 then burn down, so CI fails on _new_ violations against a committed
baseline, and the baseline shrinks per remediation PR.

| #   | Findings         | Item                                                                                                                                                                                                                                                                                           | Acceptance                                                                                                                                             |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | AUD-010 (high)   | CI lint honesty: run the linter with `--strict` in `sync-integrity.yml`; replace the `--dry-run` "Verify Architectural Rules After Sync" step with one that actually invokes the linter; align the `--strict` help text; raise/parametrize the 30s exec timeout with an explicit timeout error | A seeded boundary violation fails CI; the verify step demonstrably runs the linter; no silently-swallowed timeout                                      |
| 2.2 | AUD-011 (high)   | Close the layer-rules holes in `tools/arch-linter`: relative imports that cross layers, node builtins in domain/application, npm packages in domain (allowlist per ADR 0.8 — e.g. js-yaml in manifest domain per the HEX-026 disposition)                                                      | Linter run against the host reports the known HEX-011/012/014/027-class violations instead of "compliant"; violations recorded as the ratchet baseline |
| 2.3 | AUD-019 (high)   | A real lint job in CI: eslint (workspace), `validate-ui-boundary.sh`, and the arch-lint ratchet                                                                                                                                                                                                | All three firewall layers run on every PR; workflow required for merge                                                                                 |
| 2.4 | AUD-020 (medium) | Add `typecheck:test` to CI; fix fallout                                                                                                                                                                                                                                                        | Test-tree type errors fail CI                                                                                                                          |
| 2.5 | GOD-002, MOD-002 | arch-linter: split CLI entry from library barrel; migrate `node:test` → Vitest (ADR-0044)                                                                                                                                                                                                      | Importing the package doesn't execute the CLI; `vitest run` green; `hexagen-lint` bin unchanged                                                        |

Dependency: 2.1/2.2 after ADR 0.8 is accepted (they implement it); 2.4/2.5
independent; 2.3's eslint and UI-boundary legs are independent, but its
arch-lint-ratchet leg follows 2.1/2.2 (the ratchet baseline is 2.2's output).
2.2 is also a **published-package behavior change** — release notes required,
ships with the next npm release (release-gated, like all publishes).

**Delegation:** single Adapter Worker for 2.1+2.3 (same workflow files); Domain
Worker for 2.2 (engine logic) with a dedicated "irony check" Test/QA Worker that
runs the fixed linter against the host and diffs findings vs the review's
domain-purity list; low-effort worker for 2.4; Domain Worker for 2.5.

---

## Wave 3 — Toolchain honesty

Mostly the old Wave 1, audited severities (all now medium/low), split correctly.

| #   | Findings         | Item                                                                                                                                                                                                         | Notes                                                                                                                                           |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | MOD-001          | Delete agentic-interaction's `typescript: ^6.0.3` pin; fix any 5.9.3 errors surfaced                                                                                                                         | C6 folded here; the audit corrected the divergence claim (CI resolved 6.0.3 too — the real skew was consumers typechecking its d.ts with 5.9.3) |
| 3.2 | MOD-003, MOD-006 | Jest leftovers: agentic-interaction jest.\* + deps, root `jest.setup.js`, ui-projection-compiler `jest.config.cjs`; ai-pipeline `tsconfig.test.json` (delete or inherit ESM/bundler, drop `types: ["jest"]`) | After 3.1                                                                                                                                       |
| 3.3 | MOD-004, MOD-005 | `engines.node` per ADR 0.6; security tsconfig (extend base, dist main/types — **keep** `.js` specifiers, they are load-bearing for Node-ESM dist)                                                            | MOD-005 only if ADR 0.3 keeps the package                                                                                                       |
| 3.4 | AUD-012 (medium) | Align ts-morph across sync (^22) and arch-linter (^27); regression-test refactoring-impact parsing of ≥TS 5.5 syntax                                                                                         | Published packages; ships with next release                                                                                                     |
| 3.5 | MOD-007, MOD-008 | `Error.cause` on the listed rethrow sites; fix the llm-driver retry wrapper hang (inner throw before thenable) — **with tests**, giving llm-driver its first real suite (part of AUD-021)                    | Independent                                                                                                                                     |

**Delegation:** all five items are parallel low-effort workers except 3.4 and 3.5
(standard workers; 3.5 gets a Test/QA Worker for the retry-semantics table tests).

---

## Wave 4 — Dead-code deletion sweep

The audit's replacement for the review's rename/abstract/relocate recommendations.
Every item requires the scout's zero-consumers proof before deletion (grep +
typecheck + test), per the delegation rules.

| #   | Findings                  | Item                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | HEX-006, HEX-007, HEX-005 | Delete the dead port copies: project-configuration's `ProjectConfigurationReadPort`+`ReadManifestUseCase`, `FileSystemPort`+`NodeFileSystemAdapter` cluster; sync's dead `ProjectConfigurationReadPort` copy. Rename mcp-server's `ManifestGenerationPort` homonym (polish). **No cross-context port imports introduced** — that recommendation was refuted |
| 4.2 | HEX-023                   | Delete the zero-callers `getActiveBackend` method (not: abstract its return type)                                                                                                                                                                                                                                                                           |
| 4.3 | GOD-006 (part)            | Delete the phantom GitOps surface from `useStagedSpecGeneration` (`proposePR`/`isProposing`/`prMetadata`/`proposeError` — zero consumers, no route ever existed); extract the inline progress mapping (lines 355–529) into a named module                                                                                                                   |
| 4.4 | AUD-008, AUD-009          | external-integration: delete the dead auth hexagon (3 use-cases, 3 inbound ports, 2 driven ports, 3 VOs) and `GitHubVcsAdapter`+`IVersionControlSystem`+`@octokit/rest`; rewrite `context.yaml` to declare what the package actually does (scaffold export, editor push)                                                                                    |
| 4.5 | HEX-033, AUD-021 (part)   | api-gateway per **D3** (recommended: delete — removes the `echo` test stub with it)                                                                                                                                                                                                                                                                         |
| 4.6 | HEX-037, HEX-038          | Delete empty `*PortAdapter` stubs; stop stub-template-resolver importing composition-root `config.js`                                                                                                                                                                                                                                                       |
| 4.7 | AUD-013                   | Trim `@hexagen/sync`'s public barrel: `InMemoryConfigDouble` to a `/testing` subpath (or unexported), yaml-config.adapter + fs-utils out of the root barrel. **D6**; ships with next release                                                                                                                                                                |

All items independent; 4.4 waits for ADR 0.2 only if the context.yaml rewrite wants
the new folder doctrine (it doesn't have to).

**Delegation:** scouts fan out first across 4.1–4.6 concurrently (liveness proofs);
4.7 is a publish-surface change, not a deletion — its "consumers" are npm-external,
so it is verified via release notes and D6 instead of a grep proof. Then low-effort
deletion workers in parallel worktrees; one refuter per PR attempts to find a live
consumer the scout missed. The context.yaml rewrite in 4.4 is **worker-drafted,
Primary-applied** per the reserved-task rule, following
`.agents/yaml-editing-disciplines.md` (whose post-edit validation, `yarn lint:arch`,
is the Primary's to run).

---

## Wave 5 — Port identity, application I/O, generated output

The surviving (audit-confirmed) hexagonal repairs from old Waves 2–4, resequenced
so the HEX-012→HEX-008 dependency actually holds.

| #   | Findings                   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Depends on           |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 5.1 | HEX-002 (high)             | `GenerateProjectUseCase` behind a driven write port + in-memory FS double test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ADR 0.1              |
| 5.2 | HEX-004                    | BC-owned DTO at the application boundary only (the audited parenthetical). **Do not** swap in project-configuration's looser Manifest type — refuted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                    |
| 5.3 | HEX-012, HEX-020 (residue) | Catalog out of domain per ADR 0.5 — split: (a) local-llm; (b) agentic-interaction: migrate the sole runtime consumer of `createDefaultFallbackChain` — `apps/web/app/lib/wire.server.ts:526` (the `cloudConfig?.fallbackChain ?? createDefaultFallbackChain()` cloud default) — onto the injected catalog adapter, _then_ delete `createDefaultFallbackChain`. This is distinct from `buildStagedGenerationFallbackChain` (the env-derived Stage chain), which **stays** in wire.server. Acceptance: the no-`cloudConfig.fallbackChain` default path stays behaviorally covered by a test. (c) wire.client's inline `ProjectDiscarded` purge cascade extracted into the existing `discardProject` use case | ADR 0.5              |
| 5.4 | HEX-008                    | Split/rename the two `SecretVaultPort` contracts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 5.3(b)               |
| 5.5 | HEX-010                    | Use-case requires `TransactionManagerPort`; stops constructing `InMemoryTransactionManager`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | —                    |
| 5.6 | HEX-014, HEX-015           | ValidateTemplates / ExportGraphImage use-cases drop direct I/O (two PRs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ADR 0.1 (write port) |
| 5.7 | HEX-013                    | ts-morph behind a DTO port in sync's refactoring-impact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | after 3.4            |
| 5.8 | HEX-017                    | TUI drives the shared catalog/ports instead of inlining LLM HTTP + MCP + fs-watch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 5.3                  |
| 5.9 | HEX-001 (high), HEX-036    | Template error unions per ADR 0.7: ports stop importing `infrastructure/`; `AgentRuntimePort` emitted under application/domain; bundle regenerated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ADR 0.7              |

**Delegation:** Domain Workers per item; 5.3 is three sequential PRs by one worker
(shared context); 5.9 is an Adapter Worker plus Test/QA Worker (template + bundle
regen + generated-project First-Run-Green check via the capstone harness). Ratchet
baseline from 2.2 shrinks as each lands — each PR deletes its own baseline entries.

---

## Wave 6 — Web routes, composition roots, package fates

| #   | Findings         | Item                                                                                                                                                                                                                                                                                                                                                                                                                                      | Depends on                            |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 6.1 | AUD-004 (medium) | Extract the accept/reject saga into `AcceptTransaction`/`RejectTransaction` use cases in transaction-system (typed patch metadata — no unchecked cast); shared `validateManifestPath` + CORS/gate helper across the family                                                                                                                                                                                                                | 1.2, 1.3                              |
| 6.2 | HEX-003, HEX-034 | manifest-generate + llm-context routes stop constructing adapters; wire.server is the single composition root for these paths                                                                                                                                                                                                                                                                                                             | 5.5                                   |
| 6.3 | HEX-016 (high)   | Governance refresh decomposition: shell-lint/FS/YAML/LLM behind ports (structural half; 1.6 already unified semantics)                                                                                                                                                                                                                                                                                                                    | 1.6                                   |
| 6.4 | HEX-018          | ports/in → ports/out moves, **one package per PR**: (a) governance, (b) monaco-orchestration, (c) wizard-orchestration, (d) project-configuration (+ (e) security if ADR 0.3 keeps it)                                                                                                                                                                                                                                                    | ADR 0.2                               |
| 6.5 | HEX-019          | mcp-server tools onto inbound ports, one PR per tool family: (a) manifest-structure (create/remove context·port·adapter, add-dependency, diff-manifest), (b) transaction lifecycle (accept/reject/get/list-transaction), (c) generation & scaffold (generate-adapters/manifest-pipeline/topology, scaffold-module, submit-architectural-spec, audit-boundaries, initialize-feature-worktree, log-agent-remediation) — not one 25-class PR | 6.4, ADR 0.2 supersession of ADR-0010 |
| 6.6 | HEX-009, MOD-005 | Security package fate per ADR 0.3 (register+wire or fold)                                                                                                                                                                                                                                                                                                                                                                                 | ADR 0.3                               |
| 6.7 | HEX-025, HEX-035 | Empty barrels per ADR 0.4, split: (a) sync generator stops emitting unused layer folders; (b) remove frozen no-code packages (architectural-enforcement, code-generation — also removes their echo-fake-only suites, part of AUD-018); (c) core-domain/runtime re-export real modules; (d) `tsconfig.base.json` references reconciled (incl. the arch-linter NodeNext outlier)                                                            | ADR 0.4; (d) after 6.6                |

**Delegation:** Adapter Workers; 6.4's four PRs fan out in parallel worktrees after
the ADR; 6.5 sequenced after all of 6.4. Refuters on 6.1 (saga semantics vs the
Wave-1 integration tests) and 6.7(a) (sync self-regen and external modes both gated
— the twice-bitten trap).

---

## Wave 7 — Staged-generation decomposition (the GOD-001 arc, corrected)

The review's directive "do not split GOD-001 until HEX-011" was refuted: the
use-case imports only three pure functions from the 176-line architecture-contract
module. The real prerequisite is the stringly-typed advisory protocol (AUD-014).
Order matters throughout this wave.

| #   | Findings         | Item                                                                                                                                                                                                                                   |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | AUD-014 (medium) | Replace prefix-matched advisory copy with a structured `notices` field on the NDJSON protocol (single advisory catalog; web stops sentence-matching; fix the stale keep-in-sync pointer). Backward-compatible emission for one release |
| 7.2 | AUD-015 (medium) | Single shared post-Stage-4 repair module used by both orchestrators; R02 synthesis added to the free-text path; the duplicated callback interfaces and the "warnings only after onProgress(5,0)" temporal invariant encoded once       |
| 7.3 | AUD-016 (medium) | One R02/R03 naming module consumed by server synthesis **and** the client manifest-violation-fixer; round-trip convergence test (repair → re-validate → same names)                                                                    |
| 7.4 | HEX-011          | Prompts/R-rule text out of domain (standalone PR — **not** bundled with the split)                                                                                                                                                     |
| 7.5 | GOD-001 (high)   | Split the structured-config use-case: parse, dialect mapping, R01–R09 gate, stage orchestration as separate modules (re-exports kept one release). Wire-compat tests against the /stage NDJSON adapter                                 |
| 7.6 | GOD-009, GOD-010 | Port-mapping use-case split (LLM I/O vs salvage-parse vs policy); mcp-server manifest-generation adapter's write/event side effects into a use case                                                                                    |

Order: 7.1 → 7.2 → 7.3 (protocol settles), then 7.4/7.5 (7.4 may run parallel to
7.3), then 7.6.

**Delegation:** one Domain Worker owns 7.1–7.2 sequentially (protocol context is
the hard-won asset); refuter panel drives **both** orchestrators against the /stage
adapter and the web classifier after each PR (wire-compat is the regression risk).
7.3 gets a Test/QA Worker for the convergence property test. 7.5 is a Domain Worker
with an explicit no-behavior-change contract verified by the existing
staged-generation suites plus the 7.1 notices tests.

---

## Wave 8 — Web/React decomposition and test reality

| #    | Findings                                                                         | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Depends on                                                                      |
| ---- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 8.1  | GOD-005                                                                          | NDJSON stream reducer as pure functions + table tests; hook binds reducer to fetch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 7.1 (protocol shape)                                                            |
| 8.2  | GOD-012, GOD-003, GOD-006 (rest)                                                 | Spec/description hooks share the progress-binding helper; `ImportProjectSpecPage` becomes a step router                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 8.1, 4.3                                                                        |
| 8.3  | GOD-004 (high)                                                                   | Split ExportProvider: ZIP vs GitHub-dialog vs editor-push concerns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                               |
| 8.4  | REA-003                                                                          | CodeView boundary: presentational explorer without generation hooks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                                                               |
| 8.5  | REA-005                                                                          | Single `resolveImportedManifestPayload` consumed by export, generate, architecture-ZIP                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 8.3, 8.4 (cycle from old backlog broken per findings.json edge REA-005→REA-003) |
| 8.6  | GOD-007                                                                          | `usePlanningFinalize` extraction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                               |
| 8.7  | REA-001, REA-002, REA-006                                                        | Governance assistant: transport out of the view; boolean-lifecycle props → discriminant; capabilities fetched once                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                               |
| 8.8  | REA-004, HEX-021, HEX-030                                                        | Canvas hook split; visualization-owned map input DTO; domain node loses CSS/React-Flow fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                               |
| 8.9  | HEX-022, HEX-031                                                                 | ModelSettingsView presentation-only; `NoSemanticState` on the listed ui props                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                               |
| 8.10 | AUD-018 (high)                                                                   | Echo-fake purge: delete the 24 mock-testing suites (some die with 6.7(b)); real contract tests for live adapters in the remaining packages; `EchoFakePort` typed to real port contracts or retired                                                                                                                                                                                                                                                                                                                                                                  | 6.7(b)                                                                          |
| 8.11 | AUD-021, AUD-022                                                                 | Test targets for shared/model-settings/runtime/tui (llm-driver done in 3.5); replace api-gateway stub (or gone via 4.5); coverage posture per **D4**                                                                                                                                                                                                                                                                                                                                                                                                                | 4.5                                                                             |
| 8.12 | HEX-024, HEX-027, HEX-028, HEX-029, HEX-032, GOD-008 (residue), GOD-011, AUD-017 | Leftovers, one small PR each: (a) model-prefs port [HEX-024]; (b) template-engine path predicates [HEX-027]; (c) local-llm port wording [HEX-028]; (d) prompt-compiler type ownership [HEX-029]; (e) intent-compiler invariants [HEX-032]; (f) **name** the scaffold-defaults literal [GOD-008 residue — the rest of GOD-008's rec is already satisfied, audited]; (g) IDB salvage mapper [GOD-011]; (h) move the Generate-with-AI screen-flow state machine + device copy out of manifest-generation domain into the web feature / model-selection layer [AUD-017] | GOD-008 after 5.2                                                               |

**Delegation:** classic web-arc pattern — parallel Adapter Workers per item (these
are the most independent items in the plan), web vitest run from `apps/web` cwd,
container/presentational test conventions per the established gotchas. 8.10's
deletion set requires the scout proof per suite; its contract tests are written by
Test/QA Workers per package.

---

## Explicitly dropped or demoted (do not open PRs)

- **HEX-026** — no codec port. Documented as an accepted exception in ADR 0.8's
  allowlist (YAML text is the core domain artifact).
- **HEX-005/006/007 "single owner / import the published port"** — refuted;
  replaced by deletion (4.1).
- **HEX-020 headline** — env-derived LLM chains stay in the composition root.
- **GOD-006 "move proposePR to its own hook"** — phantom feature; deleted (4.3).
- **GOD-008 main directive** — already satisfied; only the naming residue (8.12).
- **MOD-005 ".js specifier removal"** — contradicts the repo's Node-ESM dist
  convention.
- The old backlog's non-goals all carry over (no LOC-motivated splits, no
  view-models in `@hexagen/ui`, no bundler/test-runner changes, no lib raises,
  no transaction-system deletion).

## Release-gated items

2.2, 3.3 (its `engines.node` leg only — MOD-004), 3.4, and 4.7 change the published
packages (`@hexagen-monaco/sync`, `@hexagen-monaco/arch-linter`) — they ride the next
npm release (explicit go-ahead required, per standing policy). 3.3's security-tsconfig
leg (MOD-005) is repo-internal. Everything else is repo-internal.

---

## Appendix A — Finding → item index

Every audited finding lands exactly once (dispositions included). Wave-0 ADR rows
list findings as decision _inputs_, not landings — they are excluded from the
exactly-once count; `(+…)` marks a secondary item carrying part of a finding:

| Finding | Item       |     | Finding         | Item              |     | Finding     | Item       |
| ------- | ---------- | --- | --------------- | ----------------- | --- | ----------- | ---------- |
| HEX-001 | 5.9        |     | HEX-023         | 4.2               |     | GOD-007     | 8.6        |
| HEX-002 | 5.1        |     | HEX-024         | 8.12              |     | GOD-008     | 8.12       |
| HEX-003 | 6.2        |     | HEX-025         | 6.7               |     | GOD-009     | 7.6        |
| HEX-004 | 5.2        |     | HEX-026         | dropped (ADR 0.8) |     | GOD-010     | 7.6        |
| HEX-005 | 4.1        |     | HEX-027         | 8.12              |     | GOD-011     | 8.12       |
| HEX-006 | 4.1        |     | HEX-028         | 8.12              |     | GOD-012     | 8.2        |
| HEX-007 | 4.1        |     | HEX-029         | 8.12              |     | REA-001     | 8.7        |
| HEX-008 | 5.4        |     | HEX-030         | 8.8               |     | REA-002     | 8.7        |
| HEX-009 | 6.6        |     | HEX-031         | 8.9               |     | REA-003     | 8.4        |
| HEX-010 | 5.5        |     | HEX-032         | 8.12              |     | REA-004     | 8.8        |
| HEX-011 | 7.4        |     | HEX-033         | 4.5               |     | REA-005     | 8.5        |
| HEX-012 | 5.3        |     | HEX-034         | 6.2               |     | REA-006     | 8.7        |
| HEX-013 | 5.7        |     | HEX-035         | 6.7               |     | MOD-001     | 3.1        |
| HEX-014 | 5.6        |     | HEX-036         | 5.9               |     | MOD-002     | 2.5        |
| HEX-015 | 5.6        |     | HEX-037         | 4.6               |     | MOD-003     | 3.2        |
| HEX-016 | 6.3 (+1.6) |     | HEX-038         | 4.6               |     | MOD-004     | 3.3        |
| HEX-017 | 5.8        |     | GOD-001         | 7.5               |     | MOD-005     | 3.3 (+6.6) |
| HEX-018 | 6.4        |     | GOD-002         | 2.5               |     | MOD-006     | 3.2        |
| HEX-019 | 6.5        |     | GOD-003         | 8.2               |     | MOD-007     | 3.5        |
| HEX-020 | 5.3        |     | GOD-004         | 8.3               |     | MOD-008     | 3.5        |
| HEX-021 | 8.8        |     | GOD-005         | 8.1               |     | AUD-001…003 | 1.1–1.3    |
| HEX-022 | 8.9        |     | GOD-006         | 4.3 (+8.2)        |     | AUD-004     | 6.1        |
| —       | —          |     | AUD-005/006/007 | 1.6/1.5/1.4       |     | AUD-008/009 | 4.4        |
| —       | —          |     | AUD-010/011     | 2.1/2.2           |     | AUD-012/013 | 3.4/4.7    |
| —       | —          |     | AUD-014…016     | 7.1–7.3           |     | AUD-017     | 8.12       |
| —       | —          |     | AUD-018         | 8.10 (+6.7)       |     | AUD-019/020 | 2.3/2.4    |
| —       | —          |     | AUD-021         | 8.11 (+3.5, 4.5)  |     | AUD-022     | 8.11       |

## Appendix B — Dependency corrections vs BACKLOG.md

- **Cross-wave violation fixed:** old 2.4 (HEX-008) needed HEX-012 (old 3.2, a
  later wave). Now 5.3 → 5.4.
- **Cycle broken:** old 6.3↔6.6. findings.json's edge is REA-005 → REA-003; now
  8.3, 8.4 → 8.5.
- **False parallelism fixed:** old 7.10 (GOD-008) claimed "parallel after Wave 2"
  while depending on HEX-004; now 8.12 after 5.2.
- **Unsupported gate replaced:** "HEX-011 before GOD-001" → AUD-014 (7.1) before
  GOD-001 (7.5).
- **Oversized items split:** old 2.1 (3 packages) → deletion in 4.1; old 3.2
  (3 workspaces) → 5.3(a)(b)(c); old 4.2 (3-finding bundle) → 7.4/7.5/7.6; old 4.3
  (~8 packages + root tsconfig) → 6.7(a)–(d); old 5.1 (5 packages) → 6.4 per
  package; old 5.2 (25 classes) → 6.5 by tool family.

## Appendix C — Old backlog item → new home

| Old     | New                 | Old | New         | Old       | New        |
| ------- | ------------------- | --- | ----------- | --------- | ---------- |
| 0.1–0.8 | 0.1–0.7 (C6→3.1/D5) | 3.5 | 5.5         | 6.5       | 8.7        |
| 1.1     | 3.1                 | 3.6 | 5.6         | 6.6       | 8.4        |
| 1.2     | 3.2                 | 3.7 | 5.7         | 6.7       | 8.8        |
| 1.3     | 2.5                 | 4.1 | 5.9         | 6.8       | 8.9        |
| 1.4     | 3.3                 | 4.2 | 7.4/7.5/7.6 | 7.1       | 4.2 + 8.12 |
| 1.5     | 3.2                 | 4.3 | 6.7         | 7.2       | dropped    |
| 2.1     | 4.1 (deletion)      | 4.4 | 6.6         | 7.3–7.6   | 8.12       |
| 2.2     | 4.1 (deletion)      | 5.1 | 6.4         | 7.7       | 4.5        |
| 2.3     | 4.1 + 7.6           | 5.2 | 6.5         | 7.8/7.9   | 4.6        |
| 2.4     | 5.4                 | 5.3 | 5.8         | 7.10      | 8.12       |
| 3.1     | 5.1                 | 6.1 | 8.1         | 7.11      | 8.12       |
| 3.2     | 5.3                 | 6.2 | 8.2 (+4.3)  | 7.12/7.13 | 3.5        |
| 3.3     | 5.2                 | 6.3 | 8.3 + 8.5   | —         | —          |
| 3.4     | 6.2, 6.3 (+1.6)     | 6.4 | 8.6         | —         | —          |
