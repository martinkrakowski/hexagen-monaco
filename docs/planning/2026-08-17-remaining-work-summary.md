# Remaining work — architecture-remediation arc

**As of `main` @ `ffb5d300`, 2026-08-17.** Zero PRs open. Ratchet baseline **4**.

Every figure here was measured against the tree, not carried over from a plan
document. Where a plan row and the tree disagree, the tree is recorded and the
disagreement is named — several rows in this arc turned out to understate their
finding, and one status table went stale by ~25 PRs before it was refreshed.

The live execution document is
`docs/planning/2026-08-15-architecture-remediation-execution-runbook.md`; this
file is the point-in-time snapshot of what is left.

---

## 1. Phase status

| Phase | State          | Left                                  |
| ----- | -------------- | ------------------------------------- |
| 0–5   | ✅ complete    | —                                     |
| **6** | 🔄 5 of 7      | **6.5(c)**, **6.7(a)**, **6.7(c)** ⛔ |
| **7** | ⛔ not started | 7.1 → 7.6, strictly serial            |
| **8** | 🔄 8 of 12     | **8.12(a–h)**, then 8.1 → 8.2         |

Phases 6 and 8 have no remaining decision gates. D3, D4, D6, ADR-0049, HEX-018
and the `zod` disposition were all resolved on 2026-08-16.

---

## 2. Ready to start now

Ordered by size. All four are independent of each other except where noted.

### 6.5(c) — generation & scaffold tools onto inbound ports

Third and last family of HEX-019. Families (a) #513 and (b) #518 established the
pattern; this is the same shape a third time.

- Tools: generate-adapters, manifest-pipeline, topology, scaffold-module,
  submit-architectural-spec, audit-boundaries, initialize-feature-worktree,
  log-agent-remediation.
- Confirmed not started: `packages/mcp-server/src/application/ports/in/` holds
  13 files and none of `GenerateTopologyToolPort`, `GenerateAdaptersToolPort`,
  `ScaffoldModuleToolPort`, `AuditBoundariesToolPort` or
  `SubmitArchitecturalSpecToolPort` exists.
- **Most likely of the three to contain a genuine outbound** — several of these
  tools touch scaffolding, worktrees and the filesystem. Family (b) hit this
  with `TransactionManagerPort` and correctly kept it off the inbound list.
- Inherit, do not rediscover: the scanner is `ts.createSourceFile`-based after
  three rounds of regex holes; `src/index.ts` must stay zero-diff (renaming its
  fields trips `turbo/no-undeclared-env-vars`, and `turbo.json` is never-edit).

### 8.12 — eight small independent legs

| Leg | Finding         | Scope                                                                       |
| --- | --------------- | --------------------------------------------------------------------------- |
| (a) | HEX-024         | model-prefs port — **in `packages/manifest-generation`, so blocked by (h)** |
| (b) | HEX-027         | template-engine path predicates — **may clear 2 ratchet entries**           |
| (c) | HEX-028         | local-llm port wording                                                      |
| (d) | HEX-029         | prompt-compiler type ownership                                              |
| (e) | HEX-032         | intent-compiler invariants — **package has zero live consumers**            |
| (f) | GOD-008 residue | name the scaffold-defaults literal                                          |
| (g) | GOD-011         | IDB salvage mapper                                                          |
| (h) | AUD-017         | Generate-with-AI screen-flow + device copy out of domain — **the big one**  |

Two of these carry information the plan row does not:

- **(b) may burn down ratchet entries.** Two of the four remaining are
  `packages/template-engine/src/domain/{conflict-path,output-path-safety}.ts`
  (`node-builtin-in-layer`, `node:path`). Whether the fix clears them is for the
  implementer to establish, not assume.
- **(e)'s package is unconsumed.** `grep` for `@hexagen/intent-compiler` across
  `packages/`, `apps/`, `tools/` and every manifest returns zero live consumers.
  That does not mean skip it, but it changes what invariants are worth enforcing
  and a reviewer should be told. Compare item 8.11, which found nothing depends
  on `@hexagen/runtime` either, despite `core-domain` comments claiming its code
  moved there.

### New: visualization `ports/in` → `ports/out` relocation

Surfaced by #523, not in any plan row. `GenerateHexagonalMapPort` is registered
`ports.out` in the manifest — correctly, since
`HexagonalMapGeneratorAdapter implements` it and `CanvasGraphLoadUseCase` injects
it — but the file still sits at
`packages/visualization/src/application/ports/in/generate-hexagonal-map.port.ts`.
**Folder and registry now disagree.**

This is a _new_ HEX-018 instance: `visualization` is not among the four packages
ADR-0048 §2 names, so the four 6.4 legs never covered it.

---

## 3. Must run alone

### 6.7(a) — sync stops emitting unused layer folders

Deliberately not parallelised. Measured on `main`:

```
• Layers  : 90 created, 0 updated, 0 deleted, 1 unchanged
• ESLint  : 0 created, 31 updated
• Barrels : 0 created, 1 updated, 164 skipped
• Total ops : 122
```

**`Layers: 90` is 74% of all pending sync work**, and the change deletes 31
barrels across 14 packages — three of them marker-less ones ADR-0026 preserves
as hand-written. It is also a **release-gated** change to the published engine.

Carries the twice-bitten trap: a new sync emitter must be gated for **both**
self-regen and external modes. Two prior PRs in this arc missed the second.

---

## 4. Blocked

### 6.7(c) — `core-domain` / `runtime` re-export real modules

ADR-0050's own Consequences require the **arch-linter to tolerate layer-less
contexts** first, and assign that to the enforcement-posture ADR (0.8). Doing
(c) first puts the tree in a state the current linter flags.

### Phase 7, then 8.1 → 8.2

Phase 7 is the staged-generation GOD-001 decomposition: strictly serial
`7.1 → 7.2 → 7.3 → 7.4/7.5 → 7.6`, refuter-mandatory on every PR, with
wire-compat against the `/stage` adapter and the web classifier. **It is the one
phase that cannot be fanned out**, which is why it is last.

**8.1 and 8.2 sit behind it** — the plan gates `8.1 ⇐ 7.1` and `8.2 ⇐ 8.1`. An
earlier draft of the runbook wrongly placed both in a parallel wave; corrected in
#511.

---

## 5. Human-only

Nothing below can be done by an agent.

| Item                          | State                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`0.10.0` publish**          | Staged and ready. Both packages at `0.10.0`, CHANGELOG written, ADR-0056 filed, `git tag -l "v0.10*"` is **empty**. Eleven PRs sit behind it. The **Node-20 drop** is the loudest change.                                                                                                                                 |
| **Branch protection**         | `Lint & Boundaries / ESLint + UI boundary` is not a required check, so that workflow gates nothing in practice — and it has already caught a real stale pin (#502).                                                                                                                                                       |
| **ADR-0050 §4 amendment**     | Its "arch-linter NodeNext outlier" premise is **contradicted by the tree** — `packages/sync` and `apps/tui` are also `nodenext`, and all three are the directly-Node-executed workspaces. Two agents independently measured the alignment as costing nothing and buying nothing. Amend the ADR rather than bend the code. |
| **`/api/governance/refresh`** | Has no caller. `useGovernanceData` fans out to `violations`/`suggestions`/`status`. Because that chain is the only caller of the hook that populates them, **the governance panel's violations and suggestions are permanently empty**. Retiring the endpoint vs wiring the UI is a product decision.                     |

---

## 6. Open issues

| Issue | Summary                                                                                                                                                                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #521  | `packages/model-settings` resolves its own React **19.2.5** vs `apps/web`'s **19.2.4** — a second React instance. Blocked 8.11 twice, including `react-dom` floating to 19.2.8 _within_ the workspace. A `react-dom` pin is now stacked on top as a stopgap. `KNOWN_SPLITS` suppresses the whole identifier, so drift _within_ an accepted split is invisible. |
| #510  | `useModelSelectionFlowState`'s 21 tests all pass with the hook's initial state inverted `idle` → `error`. ~15 assert only that a value exists or a function is callable. Acceptance check: that mutation must fail.                                                                                                                                            |
| #428  | Web test ergonomics — `yarn workspace web test` bin resolution.                                                                                                                                                                                                                                                                                                |

---

## 7. Known gaps in the gates themselves

Recorded because each is a check that reports more confidence than it earned —
the class this arc kept surfacing, and the reason the ratchet went 34 → 4 by
repair rather than exclusion.

- **The arch-lint ratchet is review-enforced, not machine-enforced.** A _stale_
  entry warns and exits 0; a PR that _grows_ the baseline goes green. "Shrink,
  never grow" is ADR-0054 §1 intent with no machine check behind it.
- **Nothing checks manifest-to-disk parity.** Demonstrated concretely by #512:
  with two packages deleted and both still declared, `lint:arch` reported
  _compliant_ and sync reported _34 modules processed successfully_. A guard for
  it could not be added in that PR, since the tree there **was** the divergence.
- **`lint:arch` never reads the `layers` block.** So a wrong entry in a
  `context.yaml` is a defect no gate catches — which is how #523 shipped a port
  registered inbound whose adapter implements it, until review caught it.
- **`no-feature-slice-imports` has never seen an `@/` import.** Wired at
  **error** level but returns early on any non-relative specifier.
- **`apps/web` test sources are type-checked nowhere.** Its `tsconfig.json`
  excludes test files and it has no `typecheck:test`; lifting the exclusions
  surfaces **110 pre-existing errors across 29 files**.
- **`typecheck:test` covers 18 of 36 workspaces** (measured 2026-08-17; the
  runbook's 16-of-38 predates #512's two deletions and the targets #513 and #524
  added). Widens automatically as workspaces gain the script.
- **`no-restricted-imports` does not reach dynamic `import()`.** Found in #525,
  where one `await import()` defeated a fence that blocked every static form.
  Needs a companion `no-restricted-syntax` rule.
- **ESLint flat config REPLACES rule options rather than merging them.** A
  narrowly-scoped block silently drops whatever the broader block declared for
  the files it matches. Independently demonstrated in **five** PRs this arc; it
  has already caused one real regression on `main`.

---

## 8. Test-target inventory

**34 of 36** workspaces define a real `test` script. The two that do not are
`packages/deployment` and `packages/persistence`, and that is **deliberate**:
#516 removed their targets because each package's entire `src/` is four
sync-generated empty barrels. Holding `vitest` green over nothing is the exact
failure AUD-018 documented.

They therefore sit on AUD-021's list for a **different reason** than 8.11's
three did: those had code without tests; these have no code. Whether two
`status: active` bounded contexts should hold nothing but empty barrels is
ADR-0050 territory.

---

## 9. Operational notes for the next wave

Learned the hard way during this arc; they cost real time.

- **Cap concurrency at 3–4 PRs, not six.** CodeRabbit's account limit is ~74
  reviews / 7 days refilling **1/hour**. At six parallel PRs it never reviewed
  #516 at all — three explicit review requests were refused — and its green
  check there is a rate-limit notice, not a review.
- **Do not spawn a sweeper while the builder is still running.** Doing so once
  burned 106 minutes re-verifying finished work, and two agents on one account
  **overwrote a PR description with another PR's body**.
- **Check a claimed elapsed time before repeating it.** A "stuck ~90 minutes"
  CI diagnosis was repeated three times and was an arithmetic error; the job was
  running its normal 10 minutes.
- **`.architecture/**` edits are Primary-only.** Workers report the change; it
  lands separately. Verify each name's **direction\*\* under ADR-0048, not just
  its existence — #523 registered a port inbound whose adapter implements it,
  having checked only that the file existed.
- **Force the Vitest reporter when measuring.** `vitest.shared.ts` now pins it
  repo-wide, but an ad-hoc `npx vitest` outside the repo config still selects
  the `agent` reporter in an AI-assisted shell, which runs
  `silent: "passed-only"` and hides console output from passing tests.
