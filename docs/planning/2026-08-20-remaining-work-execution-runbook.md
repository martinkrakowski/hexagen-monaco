# Remaining work — execution runbook (live, 2026-08-20)

**Date:** 2026-08-20 · **Status:** fresh inventory after the 2026-08-20 archeology audit. Waves 0 / A0 / A1 / C of the predecessor plan are on `main`; Wave B is 2 of 5; Wave D not started; Wave E one batch. **Next owner action: enable branch protection (overdue), decide D-P1, then open the 8.12(h) PR.**
**Baseline:** `origin/main` @ `4dddf1e1` (#558). Published pair: `@hexagen-monaco/sync@0.11.0` + `@hexagen-monaco/arch-linter@0.11.0`; #554's emitter change is **not yet published**.

Companion plan — [`2026-08-20-remaining-work-plan.md`](./2026-08-20-remaining-work-plan.md). Where the plan is the queue, this file tracks what has landed, what is in flight, and what to start next. Update §1, §2, §3, and §7 as items merge.

Do **not** schedule from [`2026-08-18-remaining-work-execution-runbook.md`](./2026-08-18-remaining-work-execution-runbook.md) (change log ends at #538; 17 merges stale) or any earlier runbook.

Locators are durable (file + symbol), not line numbers.

---

## 1. Status at a glance

| Track                      | Scope                                          | State                                                                                | Evidence                                             |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Remediation 0–6            | ADRs → package fates                           | ✅ **Complete**                                                                      | #439–#485, #490–#526, #544, #547–#554                |
| Remediation 7              | Staged-gen GOD-001                             | ⛔ **Not started**                                                                   | Gated on 8.12(h). DAG: 8.12(h) → 7.1 → … ; 7.4 ‖ 7.3 |
| Remediation 8              | Web/React + tests                              | 🔄 **10 of 12** — leftover **8.1, 8.2, 8.12(a)(h)**                                  | 8.3–8.11, 8.12(b–g,i), VIZ-1 landed #492–#551        |
| Satellites T4/T5/RI/FU/DOS | guards, ratchet, coverage                      | 🔄 T4/FU-2/FU-3/RI-1.3/RI-2.1+2.2/DOS-2.1/FU-1.1 ✅ · FU-1.3 b1 ✅ #555 · rest gated | see §2                                               |
| Scan/adopt arc             | #557/#558 residuals                            | ⛔ **Wave S open**                                                                   | root `pr-comment-sweep.md` (untracked) §Needs-human  |
| FDE −1/0/1/2 code          | adopt/bootstrap/report/platform                | ✅ On `main`, published `v0.11.0`                                                    | #528–#531, #533–#535, #557, #558                     |
| FDE 0.3 / gates / 3 / 4    | trial, commercial gates, inference, enterprise | ⛔ Owner-only / parked                                                               | no trial log in-repo                                 |

### Ratchet baseline trajectory

**1 entry today** (verified on the tree 2026-08-20): the template `llm-adapter` `zod` payload row. Arc started at 34.

| After                                     | Expected remaining |
| ----------------------------------------- | ------------------ |
| today (`4dddf1e1`)                        | **1**              |
| DOS-2.11 lands and the template row burns | **0**              |

R-5 (new linter rules) may _introduce_ baseline entries at rule birth; growth stays machine-blocked via `--pr-diff` thereafter.

---

## 2. Open items, exactly

Measured on `4dddf1e1`. A plan row that disagrees with the tree loses.

| Item                          | State                  | Why open / next action                                                                                                                                |
| ----------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **8.12(h)**                   | ⛔ ready               | `GenerateWithAiScreenState` still in `packages/manifest-generation/src/domain/services/model-selection-state-machine.ts`. **Start here. Land alone.** |
| **8.12(a)**                   | ⛔ blocked             | Port still inside `manifest-generation`; after (h).                                                                                                   |
| **7.1–7.6, 8.1, 8.2**         | ⛔ blocked             | 7.1 ⇐ 8.12(h); 8.1 ⇐ 7.1; 8.2 ⇐ 8.1. `execute-structured-config-generation.use-case.ts` still 3,077 lines.                                            |
| **FU-1.2**                    | ⛔ ready               | `apps/web/package.json` has no `typecheck:test`. Re-measure + e2e prereqs (plan Wave B′).                                                             |
| **FU-1.3 b2/b3**              | ⛔ ready               | 10 workspaces listed in plan Wave E. Batch pattern = #555 (zero suppressions).                                                                        |
| **FU-1.4**                    | ⛔ blocked             | after FU-1.3.                                                                                                                                         |
| **S-1**                       | ⛔ ready               | Probe parity: adopt `lstat`/ENOENT, bootstrap dry-run guard, scan `pathExists`. One PR, three RED tests. D-P2 policy recorded in body.                |
| **S-4**                       | ⛔ blocked on **D-P1** | prod image lacks `hexagen`; web scan fails closed after deploy. Owner-flagged deploy surface.                                                         |
| **R-1…R-6**                   | ⛔ ready               | Independent; each with scout proof. See plan Wave R.                                                                                                  |
| **T5.2–T5.5**                 | ⛔ blocked             | D-V1…D-V4. Splits annotated in `yarn.config.cjs` `KNOWN_SPLITS`.                                                                                      |
| **RI-1.2**                    | ⛔ blocked             | D-R1a — decidable now (counts visible since #537).                                                                                                    |
| **RI-2.3**                    | ⛔ parked              | D-R1: warn until a major.                                                                                                                             |
| **DOS-2.11**                  | ⛔ blocked             | **D-T11 write-up does not exist.**                                                                                                                    |
| **6.7(a) release tail**       | ⛔ owner               | `next` soak → D-E1 → `latest` tag. Packages still 0.11.0.                                                                                             |
| **Branch protection**         | ⛔ owner, **overdue**  | Live 404 on the protection endpoint 2026-08-20; checks were green across #535–#555.                                                                   |
| **Issues #510 / #521 / #428** | ⛔ open                | verified via `gh issue list` 2026-08-20.                                                                                                              |
| **FDE 0.3 trial**             | ⛔ owner               | the kill gate; #557/#558 are its enablement tooling.                                                                                                  |
| **Debug-repo deletion**       | ⛔ owner               | two GH-publish debug repos.                                                                                                                           |

---

## 3. Decision ledger

| Gate                                                                      | Blocks         | Status                                                                        | As of      |
| ------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------- | ---------- |
| **D-P1** ship CLI in prod image                                           | S-4            | ⛔ **Open — decidable today.** Recommend yes; feature dead in prod otherwise. | 2026-08-20 |
| **D-P2** symlink/empty-baseline overwrite policy                          | S-1 scope      | ⛔ Open — recommend keep current; record in S-1 PR.                           | 2026-08-20 |
| **D-R1a** stale-fatal ratchet                                             | RI-1.2         | ⛔ Open — counts visible since #537; decidable today.                         | 2026-08-16 |
| **D-T11** template pin + audit                                            | DOS-2.11       | ⛔ Open — **not yet written.**                                                | 2026-08-18 |
| **D-V1…D-V4** version splits                                              | T5.2–T5.5      | ⛔ Open — human.                                                              | 2026-08-15 |
| **D-E1** Node parity                                                      | 6.7(a) **tag** | ⛔ Open — tag-time gate, not PR gate.                                         | 2026-08-18 |
| **D-R1** refuse vs warn                                                   | RI-2.3         | ⛔ Open — warn until a major.                                                 | 2026-08-16 |
| **D5** TypeScript 6                                                       | nothing here   | ⛔ Own arc.                                                                   | 2026-08-16 |
| D1–D4, D6, D-C0, D-L1, D-S1, quota-D2, ADR-0049/0065/0066, HEX-018, `zod` | historical     | ✅ Resolved — do not re-litigate.                                             | —          |

---

## 4. What to start now

```text
Owner, today:
  enable branch protection (Lint & Boundaries / ESLint + UI boundary)  ← overdue
  decide D-P1 (recommend: yes) and D-P2
  write D-T11 (before anyone touches DOS-2.11)
  start the 6.7(a) `next` soak when ready to watch it (14 days)

Engineering, immediately and in parallel (≤4 labeled PRs):
  8.12(h)          ← the critical path; open first, land alone
  S-1              probe parity (adopt / bootstrap-dry-run / scan)
  FU-1.3 batch 2   (3–5 of the 10 listed workspaces)
  one Wave R item  (R-2 or R-4 suggested; scout proof in body)

After 8.12(h):
  8.12(a), then 7.1 → Wave D DAG
After D-P1:
  S-4 (code PR; deploy only on explicit go-ahead)

Do not start:
  7.1 / anything Wave D        before 8.12(h)
  8.1 / 8.2                    before 7.1
  8.12(a)                      before 8.12(h)
  S-4                          before D-P1
  DOS-2.11                     before D-T11 is written AND accepted
  T5.* / RI-1.2 / RI-2.3       before their D-gates
  FU-1.2                       mixed with any other web refactor; not before re-measure + e2e
  FDE Phase 3/4, Stripe, --llm, 0.9.x patch, FSL republish of sync@0.11.0
```

---

## 5. Operating model, Quality Gate, release procedures

The predecessor runbook's operating rules carry forward **unchanged**; restated compactly:

1. One item = one worktree = one PR. Do not bundle 8.12(h) with anything.
2. Scout before seam edits; deletions carry a zero-consumers proof in the PR body (R-2, R-4 explicitly).
3. Failing-first RED → GREEN; restore by inverse edit, never `git checkout`.
4. Refuter panel on every Phase 7 PR and published-surface change.
5. Primary lands the Quality Gate, then squash-merge with explicit subject/body; human or named deputy triggers.
6. `.architecture/**` is Primary-only; check port direction under ADR-0048; the plan's Manifest-edits column is the checklist.
7. ≤4 open `wave-*` PRs; hotfixes unlabeled; no sweeper while a builder runs.
8. Measure with the Vitest reporter forced; quote the suite count in the landing record.
9. Named-path staging only; no AI attribution; neutral phrasing; check `git branch --show-current` every commit.
10. `generator.config.yaml`, `**/dist/**`, `yarn.lock`, `turbo.json`: never-edit without owner `--force-root` authorisation. `packages/mcp-server/src/index.ts`: standing turbo env-var trap — keep zero-diff (6.5(c) precedent).

**Quality Gate (landing):**

```bash
yarn build && yarn typecheck && yarn lint && yarn test
# plus, if ports / adapters / .architecture/ moved:
yarn lint:arch
```

Published-closure items (6.7(a) tail, RI-2.3, anything shipping under `packages/sync` or `tools/arch-linter`):

```bash
node scripts/verify-publish-test-scope.js --task typecheck:test packages/sync tools/arch-linter
node scripts/verify-publish-test-scope.js packages/sync tools/arch-linter
```

### 5.1 Rollback (release-gated items)

Carried verbatim from the 2026-08-18 runbook §6.1 — it remains the recipe: a published npm version cannot be replaced; stop the bleed by re-pointing `latest` (`npm dist-tag add @hexagen-monaco/sync@0.11.0 latest`, same for arch-linter), revert on `main` by revert-PR (no history rewrite, no `yarn bump` in the revert), dated do-not-use changelog note, forward-fix under a **new** version, never unpublish after 72h. Untagged toxic merges: revert PR only; re-dispatch deploy from the revert SHA if needed.

### 5.2 Post-release observation (6.7(a) and later engine changes)

Carried verbatim from §6.2: publish under `next` first; soak **14 days** or owner sign-off (longer wins); watch this repo's `Lint & Boundaries` + `sync-integrity`, one generated-project CI vendoring `.github/actions/hexagen-conformance`, and `npm view` availability; rollback trigger = new finding class on a previously clean generated repo, or install/`sync --check` failure attributable to the new version; **D-E1** is a tag gate, not a soak-skip; only then `latest`.

---

## 6. Global constraints

No `Co-Authored-By` / "Generated with" trailers · neutral phrasing, no names, in PR text · squash-merge with explicit subject/body · reviewer's-guide comment on every PR · pre-empt bot flags, never merge on a bot's say-so · release / deploy / tag only on explicit owner go-ahead · historical planning docs get banners, never rewrites · root `pr-comment-sweep.md` stays untracked by request.

---

## 7. Change log

### 2026-08-20 — opened

First version, from the six-track archeology audit against #437–#558. Deltas vs the 2026-08-18 runbook: Waves A0/A1/C recorded complete (#536–#555); ratchet baseline re-measured at **1**; Wave S (scan/adopt hardening) and Wave R (residual polish) absorbed from the #557/#558 sweep and the dossier's open escalations; new gates D-P1/D-P2; D-R1a flagged decidable; branch protection flagged **overdue** (live 404 re-verified); 6.7(a) noted unpublished pending soak + D-E1.
