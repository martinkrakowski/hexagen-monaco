# Remaining work — execution runbook (live)

**Date:** 2026-08-18 · **Status:** Wave 0 lands in **#535**. Wave A0 is the engineering wavefront. Wave A1 waits on #535 merging. **Next owner action:** enable branch protection after #535 is green on `main`.
**Baseline:** `main` @ `08024dd3` (`v0.11.0`) plus #535 (`chore/remaining-work-wave-0`).

This is the **live operating runbook** for the leftover work from the 2026-08-14 through
2026-08-18 planning window. It is the companion to — not a replacement for — the plan:

- **Plan** — [`2026-08-18-remaining-work-plan.md`](./2026-08-18-remaining-work-plan.md)

Where the plan is the queue, this file tracks **what has landed, what is in flight, and
what to start next**. Update §1, §3, and §8 as items merge.

Do **not** schedule from
[`2026-08-15-architecture-remediation-execution-runbook.md`](./2026-08-15-architecture-remediation-execution-runbook.md)
or
[`2026-08-18-architecture-remediation-completion-plan.md`](./2026-08-18-architecture-remediation-completion-plan.md).
Both are stale against `08024dd3`.

Locators are durable (file + symbol), not line numbers.

---

## 1. Status at a glance

| Track                       | Scope                                                      | State                                                              | Evidence                                                                           |
| --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Remediation 0–5             | ADRs, triage, ratchet, toolchain, deletions, port identity | ✅ **Complete**                                                    | `#439`–`#485`, `#469`–`#481`, `#490`                                               |
| Remediation 6               | Routes / package fates                                     | 🔄 **5 of 7** — leftover **6.5(c), 6.7(a), 6.7(c)**                | 6.5(a) `#513`, 6.5(b) `#518`, 6.7(b) `#512`, 6.7(d) `#517`                         |
| Remediation 7               | Staged-gen GOD-001                                         | ⛔ **Not started**                                                 | DAG: 8.12(h) → 7.1 → … ; 7.4 ‖ 7.3                                                 |
| Remediation 8               | Web/React + test reality                                   | 🔄 **9 of 12** — leftover **8.1, 8.2, 8.12(a–d, f–i)** + **VIZ-1** | 8.3–8.11 and 8.12(e) landed `#492`–`#526`                                          |
| FDE −1 / 0 / 1 / 2 **code** | ADRs, adopt/bootstrap, report, platform seam               | ✅ **On `main`, published `v0.11.0`**                              | `#528`–`#531`, `#533`, `#534`                                                      |
| FDE 0.3 / 1-gate / 2-gate   | Foreign-repo trial, external CI, paid history              | ⛔ **Owner-only**                                                  | No trial log in-repo. Pay-gate is **not** a remediation resume trigger after D-C0. |
| FDE 3 / 4                   | Inference / enterprise                                     | ⛔ **Deferred by design**                                          | Do not schedule                                                                    |
| Satellites                  | T4/T5, RI, FU                                              | 🔄 **Partial**                                                     | See §2                                                                             |

### Ratchet baseline trajectory

Today **4** entries. Started the remediation arc at 34.

| After                                       | Expected remaining | Which keys leave                                                                       |
| ------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| today (`08024dd3`)                          | **4**              | —                                                                                      |
| 8.12(b)                                     | **2**              | `template-engine` `conflict-path.ts` / `output-path-safety.ts` `node:path`             |
| 8.12(i)                                     | **1**              | `migrate-manifest.use-case.ts` `node:util`                                             |
| DOS-2.11 (then burn the template `zod` row) | **0**              | template payload `zod` — only after the emitted `package.json` can actually provide it |

If a landing does not delete its own keys, the trajectory stalls. That is a review fail, not a new baseline.

**Published packages:** `@hexagen-monaco/sync@0.11.0` and `@hexagen-monaco/arch-linter@0.11.0`. There is no `v0.10.0`. Live license policy is **ADR-0066**.

---

## 2. Open items, exactly

Measured on `08024dd3` + #535. A plan row that disagrees with the tree loses.

### Wave 0 (human + docs) — lands in #535

| Item      | State                | Evidence                                                                                                                                          |
| --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-C0**  | ✅ **lands in #535** | ADR-0059 amendment: capacity-freed is the resume trigger; pay-gate / kill-criterion retired as _resume_ triggers.                                 |
| **DOC-1** | ✅ **lands in #535** | `CHANGELOG.md` §0.11.0: arch-linter FSL, sync stays evaluation (ADR-0066).                                                                        |
| **DOC-2** | ✅ **lands in #535** | `commands/bootstrap.ts` deleted. Helpers and `bootstrapCommander` live on `commands/bootstrap/index.ts`. `bootstrap.test.ts` imports that module. |

### Wave A0 — not parked

| Item                | State          | Notes                                                                                                                                                                                         |
| ------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T4.1–T4.4**       | ⛔ not started | Guard still inspects workspace `scripts` only. T4.4 is the permanent CI owner. Landing requires a failing-first undeclared-binary fixture and a non-zero discovery floor (empty scan = fail). |
| **FU-2**            | ⛔ not started | Jest guard does not scan `.github/workflows/`. Same anti-vacuity + RED fixture (`npx jest` in a workflow). Empty workflow scan = fail.                                                        |
| **RI-1.3**          | 🔄 partial     | Run already prints suppressed count; stale vs fresh not equally visible.                                                                                                                      |
| **RI-2.1 / RI-2.2** | ⛔ not started | `RefactoringImpactUseCase` still ignores syntactic diagnostics.                                                                                                                               |
| **DOS-2.1**         | ⛔ not started | `.slice(0, 10)` in both prompt-compiler adapters.                                                                                                                                             |
| **FU-1.1**          | ⛔ not started | `packages/local-llm` config exists; script missing.                                                                                                                                           |

### Blocked on D-C0 (Wave A1 / C / D / remaining 8.12)

| Item                      | State           | Why it is still open                                                                        |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| **6.5(c)**                | ⛔ not started  | No generation/scaffold `*ToolPort` under `ports/in/`.                                       |
| **6.7(a)-FIX / 6.7(a)**   | ⛔ not started  | No external-repo fixture. `layer-folders.ts` still `mkdir`s every declared layer.           |
| **6.7(c)-SCOUT / 6.7(c)** | 🔄 partial / ⛔ | Empty `@generated` `export {}` barrels remain. Scout has no artifact yet.                   |
| **7.1–7.6**               | ⛔ not started  | Also gated on **8.12(h)** for 7.1.                                                          |
| **8.1 / 8.2**             | ⛔ not started  | Gated on 7.1.                                                                               |
| **8.12(a)**               | 🔄 partial      | Port exists inside `manifest-generation` — blocked on 8.12(h).                              |
| **8.12(b)**               | ⛔ not started  | `node:path` still in template-engine domain.                                                |
| **8.12(i)**               | ⛔ not started  | `MigrateManifestUseCase` still imports `node:util`. **This was the orphaned baseline row.** |
| **8.12(c)(d)(f)(g)(h)**   | ⛔ not started  | See plan locators.                                                                          |
| **VIZ-1**                 | ⛔ not started  | Port still under `ports/in/`.                                                               |

### Gated / owner

| Item                                | State                           |
| ----------------------------------- | ------------------------------- |
| **T5.2–T5.5**                       | ⛔ need D-V1…D-V4               |
| **RI-1.2**                          | ⛔ need D-R1a                   |
| **FU-1.2**                          | ⛔ re-measure + e2e required    |
| **FU-1.3 / FU-1.4**                 | ⛔ after FU-1.1                 |
| **FU-3 remainder / eslint**         | 🔄 3 pins left                  |
| **DOS-2.11**                        | ⛔ blocked on D-T11             |
| FDE 0.3 / Phase 1–2 gates           | ⛔ owner-only                   |
| Branch protection                   | ⛔ **after** Wave 0, not before |
| Issues **#510**, **#521**, **#428** | ⛔ OPEN                         |

---

## 3. Decision ledger

| Gate                                | Blocks                           | Status                                                                                                                        | As of      |
| ----------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **D-C0** unpark 6–8                 | Wave A1 / C / D / remaining 8.12 | ✅ **Resolved in #535** — ADR-0059 amendment names **capacity-freed**; pay-gate / kill-criterion stay FDE product gates only. | 2026-08-18 |
| **D-L1** changelog vs ADR-0066      | DOC-1                            | ✅ **Resolved in #535** — changelog follows 0066.                                                                             | 2026-08-18 |
| **D-E1** Node 22.7 / 22.12 / 24     | 6.7(a) **tag**, not the PR       | ⛔ **Open**                                                                                                                   | 2026-08-18 |
| **D-T11** template pin + audit      | DOS-2.11                         | ⛔ **Open** — item does not start until written.                                                                              | 2026-08-18 |
| **D-V1…D-V4** version splits        | T5.2–T5.5                        | ⛔ **Open** — human. T5.1 shipped.                                                                                            | 2026-08-15 |
| **D-R1a** stale-fatal               | RI-1.2                           | ⛔ **Open** — ship RI-1.3 first.                                                                                              | 2026-08-16 |
| **D-R1** refuse vs warn             | RI-2.3                           | ⛔ **Open** — stay at warn until a major.                                                                                     | 2026-08-16 |
| D1 / D2 / D3 / D4 / D6              | historical                       | ✅ Resolved                                                                                                                   | 2026-08-16 |
| D5 TypeScript 6                     | none                             | ⛔ Own arc                                                                                                                    | 2026-08-16 |
| ADR-0049 / HEX-018 registry / `zod` | historical                       | ✅ Resolved                                                                                                                   | 2026-08-16 |
| D-S1 (FU-3 meaning)                 | FU-3                             | ✅ all nine genuine debt                                                                                                      | 2026-08-16 |
| FDE D-0…D-4 / quota-D2              | positioning                      | ✅ ADRs 0059–0066. Live license = **0066**.                                                                                   | 2026-08-18 |

---

## 4. What to start now

```text
Owner, after #535 is green and merged:
  enable branch protection (Lint & Boundaries / ESLint + UI boundary)
  THEN Wave A1

Wave A0 (not parked; can start now):
  T4.1 + T4.2   (one PR ok)
  T4.3  T4.4
  FU-2
  RI-1.3
  RI-2.1 + RI-2.2
  DOS-2.1
  FU-1.1

Human, not same-day as protection:
  #510 / #521 / #428 triage
  D-T11 write-up (before anyone starts DOS-2.11)

After #535 merge — Wave A1, ≤4 labeled PRs:
  6.5(c)   8.12(b)(c)(d)(f)(g)(i)   VIZ-1

Do not start:
  Wave A1 / 6.7* / 7.* / 8.12(h)   before #535 merges
  8.1 / 8.2                        before 7.1
  8.12(a)                          before 8.12(h)
  7.1                              before 8.12(h)
  6.7(a)                           before 6.7(a)-FIX
  6.7(c)                           before 6.7(c)-SCOUT
  FU-1.2                           mixed with any other web refactor;
                                   and not before re-measure + e2e
  T5.*                             before D-V*
  RI-1.2                           before D-R1a
  DOS-2.11                         before D-T11
  branch protection                before #535 is green on main
  Phase 3 / 4 / Stripe / --llm
  a 0.9.x patch, or FSL republish of sync@0.11.0
```

---

## 5. Operating model

1. **One item = one worktree = one PR.** Lettered sub-items are already the unit. Do not bundle 8.12(h) with anything.
2. **Scout before seam edits.** Public API, injection points, and every deletion get a zero-consumers proof in the PR body. 6.7(c)-SCOUT has a _defined artifact_ (plan Wave C).
3. **Failing-first.** RED → GREEN. Restore by inverse edit, never `git checkout`.
4. **Refuter panel** on 6.7(a), every Phase 7 PR, and published-surface changes. **Not a substitute** for 6.7(a)-FIX.
5. **Primary lands** the Quality Gate, then squash-merge. Human (or a named deputy) triggers the merge. Wave D does not grow a second landing path.
6. **`.architecture/**` is Primary-only.** Check each port’s **direction** under ADR-0048 (`#523` registered a driven port inbound). Use the plan’s Manifest-edits column.
7. **Concurrency:** ≤4 open `wave-*` PRs. Hotfixes unlabeled. No sweeper while a builder runs.
8. **Measure with the reporter forced.** Ad-hoc `npx vitest` still hides passing-test console output.
9. **Named-path staging only.** Never `git add -A`.
10. **No AI attribution.** Neutral commit / PR language.

### Standing build notes

- **6.5(c)** inherits 6.5(a)(b) **and** adds a structural assertion (plan Wave A1). `src/index.ts` stays zero-diff.
- **6.7(a)** does not start without 6.7(a)-FIX on `main`. Re-measure `Layers:` on current `main`; the 2026-08-17 “90 created” figure is a snapshot.
- **6.7(c)** does not open without 6.7(c)-SCOUT on `main`.
- **8.12(b)** deletes two baseline keys if they no longer reproduce. **8.12(i)** deletes the `node:util` key. Do not grow the baseline.
- **FU-1.2** figure “110 / 29” is **stale**. Re-measure is prerequisite 1; e2e is prerequisite 2.
- **7.6** side effects stay in adapters behind an outbound port.

---

## 6. Quality Gate (landing)

```bash
yarn build && yarn typecheck && yarn lint && yarn test
# plus, if ports / adapters / .architecture/ moved:
yarn lint:arch
```

The landing record **must quote the `yarn test` suite count** (files and tests). A gate with no count is not a record.

Published-closure items (6.7(a), RI-2, anything under `packages/sync` or `tools/arch-linter` that ships):

```bash
node scripts/verify-publish-test-scope.js --task typecheck:test packages/sync tools/arch-linter
node scripts/verify-publish-test-scope.js packages/sync tools/arch-linter
```

Do not tag a release from this wavefront unless the owner says so. `v0.11.0` already published the current public surface. 6.7(a) is the next likely release-gated change.

### 6.1 Rollback recipe (release-gated items)

Applies to **6.7(a)**, **RI-2.3**, and any other change that ships in a `v*` tag of `@hexagen-monaco/sync` or `@hexagen-monaco/arch-linter`.

A published npm version **cannot be replaced**. “Rollback” means stop the bleed, then ship a forward fix.

1. **Stop recommending the bad tag.** Do not delete `v0.12.0` (or whatever shipped) from git unless it never reached npm. If it reached npm:
   - Do **not** `npm unpublish` after 72 hours (registry policy; also breaks lockfiles).
   - `npm dist-tag add @hexagen-monaco/sync@0.11.0 latest` (and the same for `arch-linter`) so `latest` points at the last good pair. Leave the bad version on the registry; it is just no longer `latest`.
   - If the tag was a pre-release on `next`, move `next` back to the previous pre-release.
2. **Repo.** Revert the landing commit(s) on `main` with a revert PR (not a rewrite of history). Do **not** run `yarn bump` as part of the revert.
3. **Changelog.** Add a dated note under the bad version: “do not use; `latest` rolled back to X.Y.Z; reason in one sentence.”
4. **Consumers.** Generated projects pin `^<engine version>`. Anyone who already installed the bad minor stays there until they change the pin — that is the 0.x caret fence working. Announce: stay on `0.11.0` (or the last good) until the forward patch/minor.
5. **Forward fix.** Bump (lock-step via `scripts/bump-version.js`), tag, publish. Never republish the same version number.
6. **A toxic merge that was _not_ tagged.** Revert PR on `main`. No npm action. If deploy.yml was dispatched from that SHA, re-dispatch from the revert SHA after F1 still passes on the last published version.

Hotfix PRs carry **no** `wave-*` label and jump the concurrency cap.

### 6.2 Post-release observation (release-gated items)

For 6.7(a) and any later published-engine change:

1. Publish first under the **`next`** dist-tag (`publish.yml` already does this for versions with a `-` pre-release identifier). Soak **14 days** or until the owner signs off, whichever is longer.
2. Watch, at minimum:
   - this repo’s `Lint & Boundaries` and `sync-integrity` on `main`
   - any generated-project CI that vendors `.github/actions/hexagen-conformance` (the in-repo action plus one external install if the Phase 1 gate has a volunteer)
   - `npm view @hexagen-monaco/sync@<version>` / `arch-linter` still 200
3. **Rollback trigger:** a new `hexagen-lint` finding class appearing on a previously clean generated repo, or `yarn install` / `hexagen sync --check` failing on the soak target, attributes to the new version. Execute §6.1.
4. Only then retag / publish a stable `latest` (plain `X.Y.Z`, no `-`).
5. D-E1 (Node 22.12 + 22.7 or 24) is a **tag** gate, not a soak-skip.

This is not wild crash telemetry and not a client `manifest.yaml` backup product.

---

## 7. Global constraints

- No `Co-Authored-By` / “Generated with …” trailers.
- Neutral phrasing, no names, in PR bodies and comments.
- Check `git branch --show-current` every commit.
- Squash-merge with explicit subject/body; a human or named deputy triggers it.
- Reviewer’s-guide comment on every PR.
- Pre-empt bot flags; never merge on a bot’s say-so.
- Release / deploy / tag only on explicit go-ahead, then §6.1 / §6.2.
- Historical positioning drafts stay provenance. Do not “catch them up”.
- `generator.config.yaml`, `**/dist/**`, `yarn.lock`, `turbo.json` remain never-edit unless the owner authorises `--force-root`.

---

## 8. Change log

### 2026-08-18 — opened

First version. Inventory against `08024dd3` after `v0.11.0`.

### 2026-08-18 — adversarial amendment

Absorbed two reviews. Material deltas:

- D-C0 must **rewrite ADR-0059 triggers** (capacity-freed; pay-gate / kill-criterion retired as resume triggers).
- Wave A split into **A0** (start now) and **A1** (after D-C0).
- **8.12(i)** owns the orphaned `migrate-manifest` `node:util` baseline row. Trajectory table in §1.
- Wave D relabeled a **DAG**; 7.1 gated on **8.12(h)**, not “Waves A–C”.
- **6.7(a)-FIX** (external-repo fixture) and **6.7(c)-SCOUT** (defined artifact) are prerequisites, not process notes.
- **7.6** side effects stay in adapters behind an outbound port.
- T4 grows **T4.4** (permanent CI guard). DOS-2.11 blocked on **D-T11**. FU-1.2 gets a numbered re-measure + e2e gate; 110/29 marked stale.
- Branch protection **after** Wave 0. Rollback §6.1 and observation §6.2 added.
- Concurrency: withdrawn the inconsistent “74 / 7 days, refill 1/hour” claim; ≤4 labeled PRs; hotfixes unlabeled.
- Out of scope: 0.9.x patch, FSL republish of `sync@0.11.0`, CodeRabbit circuit-breaker, wild telemetry, automated canary-replacing-the-owner-tag.
- Manifest-edits column on every wave table. Decision-ledger timestamps.

Rejected as over-scope for this arc: implementing a new `@canary` publisher (use existing `next`), CodeRabbit 80% pause, CLI crash reporting, client manifest backup.

### 2026-08-18 — Wave 0 landed in #535

D-C0, DOC-1, and DOC-2 land in this PR. Next owner action is enable branch protection after the required checks are green on `main`. Wave A0 remains the engineering wavefront; Wave A1 waits on the merge.
