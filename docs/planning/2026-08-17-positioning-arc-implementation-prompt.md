# Implementation Prompt — Conformance Positioning Arc

**Purpose:** hand this prompt, verbatim, to the implementing agent/dev session for each phase of the
positioning arc. It is self-contained: mission, gates, ground rules, phase instructions with
acceptance criteria, and the complete file inventory.

**Line-number caveat:** all `file:line` references describe the tree as of main `8d5c080b`
(2026-08-17). Treat them as anchors, not gospel — re-locate by content if the file has moved on.

---

## Prompt

You are implementing the Hexagen-Monaco conformance repositioning. The execution document is
`docs/planning/2026-08-17-fde-gtm-development-runbook.md` — it is fully adjudicated after three
review rounds and is the single source of truth for scope, estimates, and gates. Where this prompt
and the runbook disagree, the runbook wins.

### Mission

Reposition the product from generator to **architectural conformance platform**. The conformance
engine already exists and is published; your work is (Phase 0) decoupling it from Hexagen-generated
layouts and building the assisted brownfield on-ramp, (Phase 1) packaging the FDE engagement kit and
public distribution surface, (Phase 2, gated) platform/revenue infrastructure. You are NOT building
autonomous manifest inference — that is explicitly deferred (runbook Phase 3, behind a ground-truth
corpus).

### HARD GATE — verify before writing any code

Phase −1 decisions must exist as ADRs in `.architecture/decisions/` before any Phase ≥0 work:
D-0 (capacity), D-3 (business vs. consulting), D-1 (license split incl. the `packages/sync`
sub-decision), D-2 (README batch), quota-D2 (metering disposition), D-4 (deploy topology).
**Check for them. If they are missing, stop and report — do not proceed on the runbook's
recommendations alone.** They change what you build (D-1 gates Phase 1.2 entirely; D-4 gates
Phase 2 schema work).

### Reading order

1. `docs/planning/2026-08-17-fde-gtm-development-runbook.md` — the execution doc (self-contained).
2. `docs/planning/2026-08-17-positioning-plan-independent-review.md` — evidence behind every
   amendment; §8 is the adjudication record.
3. The Phase −1 ADRs (once they exist).
4. Historical context only (do not act on them; both carry status banners):
   `2026-08-17-positioning-plan-validation-and-adversarial-review.md`,
   `2026-08-17-conformance-positioning-plan.md`. Provenance:
   `2026-08-17-positioning-plan-review-prompt.md`.
5. Decision-record background you must not contradict:
   `docs/planning/llm-execution-and-free-tier-overhaul.md:207-213` (quota-D2 closeout),
   `docs/planning/2026-07-25-remaining-work-consolidated-plan.md:139` (original D2),
   `.architecture/decisions/ADR-0046-github-publish-workflow-scope.md`,
   `docs/planning/2026-07-21-import-round-trip-integrity.md` (A6 part 1 background),
   `docs/planning/2026-08-17-remaining-work-summary.md` (D-0 input).

### Ground rules (repo conventions — non-negotiable)

- **Failing-first tests** for every behavior change: the test fails before the fix, passes after.
  Then the gate: `yarn build && yarn typecheck && yarn lint`, then `yarn test`; record the suite
  count in the PR.
- Project instructions live in `AGENTS.md` (not CLAUDE.md). ADRs live in `.architecture/decisions/`.
- Contract tests in `packages/sync/__tests__/contract/` spawn a physically-copied `dist/cli.js`
  (`packages/sync/__tests__/helpers/published-layout.ts`) — build both packages before running them.
  `apps/web` component tests run with vitest **from `apps/web` cwd**.
- Pre-commit runs prettier + eslint via lint-staged; unused vars are **errors** at commit time even
  though `turbo lint` only warns. Stage explicit paths only — never `git add -A`. Run
  `git branch --show-current` before every commit.
- **Never push a `vX.Y.Z` tag** — tags trigger a live npm co-publish and are release-gated by the
  owner. The registry's latest is v0.9.0; the tree is 0.10.0 unpublished (a breaking minor).
- **Do not touch quota metering.** The spec→convert double-charge and the signed-in/generate
  inconsistency are governed by the quota-D2 ADR (disposition: leave as-is; the inconsistency is a
  recorded product question for the subscription gate). Any "fix" here reverses a closed decision.
- Do not edit the two historical planning docs (banner convention preserves them verbatim).
- New sync emitters need gating for BOTH self-regen and external modes (a known trap, hit 3×).
- Every open PR you touch gets a reviewer's-guide comment in addition to the PR body. Pre-empt bot
  reviewers by commenting correct-but-flaggable patterns inline.

---

## Phase 0 — Foreign-repo validation (3–5 weeks)

### 0.1 `hexagen adopt` — layout mapping + linter hardening (~2–2.5 wks; 2.5–3.5 if `sync --check` mapping included)

Build `.architecture/layout.yaml` (schema per the runbook example: per-context `root`, per-layer
directory lists, `ignore`) consumed by the linter, plus the five hardening fixes. Work items, each
with its anchor:

| #   | Work item                                                                                                                                                                                                     | Files                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Layout-config discovery & loading; **zod schema with unknown-key rejection** — invalid config exits 2; absent/empty optional config keeps today's behavior                                                    | `tools/arch-linter/src/cli.ts:73-117` (root discovery ladder), `tools/arch-linter/src/optional-yaml-config.ts` (`:89` unchecked cast to replace)                                                                                                              |
| 2   | **tsconfig guard**: accept plain `tsconfig.json` / configurable path / try-catch with actionable error (currently unguarded, crashes with raw stack = wrong exit class)                                       | `tools/arch-linter/src/cli.ts:144,304-306`                                                                                                                                                                                                                    |
| 3   | **Vacuous-run loud failure**: exit 2 when **zero resolvable files scanned** (NOT "any missing context dir is fatal" — generated repos legitimately declare contexts pre-scaffold); report files-scanned count | `tools/arch-linter/src/cli.ts:363-367` (silent skip), `:735-737` ("Architecture is compliant" banner)                                                                                                                                                         |
| 4   | **Configurable purity-check layer dispatch** (currently hardcoded `/domain/`, `/application/` substrings). Do NOT rebuild allowed-imports resolution — `getLayerAllowedImports` is already config-driven      | `tools/arch-linter/src/cli.ts:442,514`, `tools/arch-linter/src/layer-purity-violation.ts` (`:66-71` DEFAULT_LAYER_NAMES, `:229`, `:269-288` hardwired layer targets), `tools/arch-linter/src/layer-import-violation.ts:70-79` (already config-driven — leave) |
| 5   | **Scope-prefix decoupling** for unscoped/multi-scoped repos                                                                                                                                                   | `tools/arch-linter/src/cli.ts:414`, `tools/arch-linter/src/resolve-scope.ts`                                                                                                                                                                                  |
| 6   | Layout-aware classification in sync (config-driven mode alongside convention mode)                                                                                                                            | `packages/sync/src/domain/services/layer-classifier.ts:59-87`                                                                                                                                                                                                 |
| 7   | Degrade layout-mapped repos to advisory for the on-disk-shape rule                                                                                                                                            | `tools/arch-linter/src/required-communication-violation.ts:74-94,127,134`                                                                                                                                                                                     |
| —   | No changes needed                                                                                                                                                                                             | `tools/arch-linter/src/ratchet-baseline.ts` (works as-is for brownfield landing)                                                                                                                                                                              |

Reference material: the other rule sources (`cross-package-violation.ts`, `server-marker-violation.ts`,
`subpath-violation.ts`, `index.ts`, `logger.ts`), the launcher `tools/arch-linter/bin/lint-arch.mjs`
(exit-2-if-unbuilt contract), the 12 suites in `tools/arch-linter/__tests__/`, the exit-code
vocabulary at `cli.ts:53-69`, config inputs `.architecture/invariants/layer-rules.yaml` and
`.architecture/invariants/linter-config.yaml`, manifest schema
`packages/project-configuration/src/domain/model/manifest-schema/manifest-schema.ts:328,349`
(`bounded_contexts` required, `.strict()`), CI consumers `.github/workflows/lint.yml:150,155,167-172,180`
and `.github/workflows/sync-integrity.yml:85`, current baseline `.architecture/arch-lint-baseline.json`.

**DoD (all five, each with a failing-first test):** (a) exit 2 + clear message on zero files scanned;
(b) files-scanned count reported; (c) purity dispatch works via config on a `core/`/`services/` repo;
(d) no ts-morph crash on plain `tsconfig.json`; (e) misspelled `layout.yaml` mapping fails loudly.
Overall: a non-vacuous, mostly-true report on a repo with zero Hexagen ancestry using only
`layout.yaml` + a manifest.

### 0.2 `hexagen bootstrap` — assisted manifest creation (~1–1.5 wks)

Interactive, deterministic-first, no LLM required. Read workspaces/package graph + ts-morph import
graph (reuse `packages/sync/src/generators/port-analyzer.ts` infrastructure); propose candidate
contexts **as questions, never assertions**; human ratifies in the terminal; emit `manifest.yaml` +
`layout.yaml` + `arch-lint-baseline.json` in one pass. Optional `--llm` enrichment via the existing
provider stack. New command lives beside `packages/sync/src/commands/{add,arch,manifest,shared,templates}/`;
CLI entry `packages/sync/src/cli.ts:62-131`. There is deliberately no `init`/`import`/`infer` command
today — you are adding the first, and it must follow the one-shot-trust rule.

### 0.3 The trial (1 wk, overlaps) — run by the owner; your job is tooling support and the fix log

(every hand-fix is Phase 3 corpus seed).

### 0.4 Trust fixes (small, parallel)

| Fix                                                | File                                                                                                                        | Protocol                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete stale "ships dark / NOT yet routed" comment | `packages/agentic-interaction/src/application/use-cases/staged-generation/execute-full-staged-generation.use-case.ts:19-21` | Doc-only; no test. Route reality: `apps/web/app/api/manifest/generate/stage/route.ts:4,150,159`; seam-removal notes at `stage/route.ts:136-137` and `stage/pipeline-selection.ts:11-13` |
| `hasByokKey` per-provider instead of aggregate     | `apps/web/app/api/manifest/capabilities/route.ts:22-26`                                                                     | Failing-first test, then gate + suite count                                                                                                                                             |

**Do not** modify: `apps/web/lib/enforce-quota.ts`, any of
`apps/web/app/api/manifest/generate/{,stage,spec,spec/convert,local}/route.ts`,
`apps/web/app/api/plan/extract-decisions/route.ts`, `apps/web/app/api/llm/chat/route.ts` (quota-D2).

---

## Phase 1 — FDE kit + distribution (5–7 wks; gated on Phase 0 gate + D-1 ADR)

### 1.1 `hexagen report` (~1 wk)

Self-contained HTML/Markdown engagement artifact: context map (reuse the accept-view Mermaid
renderer in `apps/web` — see `ManifestAcceptPage` and the accept feature), drift summary vs.
baseline, ratchet trend **from git history of `.architecture/arch-lint-baseline.json`** (no server),
suppression ledger.

### 1.2 CI action + per-PR comment (~3–4 wks) — ONLY if D-1 = fair-source wedge

Wrap `hexagen-lint --ratchet` + `sync --check`. Per-PR diffing is **new engineering**, not a
wrapper: base-branch checkout/cache, base-baseline computation, violation diff, rename handling
(identity key `rule|file|specifier` breaks on rename — `tools/arch-linter/src/ratchet-baseline.ts:22-24,56-58,147-169`),
and machine-enforced baseline growth for the first time (today review-enforced only,
`.github/workflows/lint.yml:167-172`). Migrate the auto-injected workflow
(`packages/project-generation/src/domain/sync-integrity-workflow.ts`, `SYNC_INTEGRITY_WORKFLOW`) to
this action so greenfield and brownfield share one surface. Comment only _this PR's_ violations;
silent when clean — never ship a comment that reports pre-existing violations.

### 1.3 Suppressions with reason + expiry (~2–3 days)

Extend the baseline entry format (`reason`, `expires`; expired suppressions fail the gate).
Formalize the schema while you're in there — `parseBaseline` currently tolerates unknown fields
(`ratchet-baseline.ts:124-134`) and one live entry carries an informal `note`. Ripples to check:
`.github/workflows/lint.yml` (incl. the stale "34 accepted entries" comment at `:155` — real count
is 4) and the published-consumer contract layout (`packages/sync/__tests__/contract/`,
`packages/sync/__tests__/helpers/published-layout.ts:46,145,222-227`).

### 1.4 Agent-constraint hardening (~1 wk)

The bypass is **confirmed**: route these seven use-cases through the transaction-approval path —
`packages/mcp-server/src/application/use-cases/{create-context,add-dependency,create-port,create-adapter,remove-port,remove-context,scaffold-module}-tool.use-case.ts`
(all consume `ManifestWritePort` directly; the approval family is
`{get,list,accept,reject}-transaction-tool.use-case.ts` + `InMemoryTransactionManager`). Tool
registry: `packages/mcp-server/src/infrastructure/adapters/tools/registry.ts:22-42` (19 tools);
resources: `packages/mcp-server/src/infrastructure/adapters/resources/index.ts`. Add the pre-commit
`hexagen_audit_boundaries` / `hexagen-lint --staged` hook and the pin-agent-to-one-context workflow
doc.

### 1.5 Handoff pack (~2 days) — `hexagen report --handoff`: report + manifest + layout + baseline +

suppression ledger, zipped.

### 1.6 Engagement security one-pager (~1 day)

Data-flow truth table. Local/deterministic: linter, adopt, bootstrap, report, baseline. LLM paths,
named: cloud generation via OpenRouter; BYOK is a **server-side proxy** (ADR-0030,
`packages/byok/src/infrastructure/adapters/aes-gcm-encryption.adapter.ts`,
`apps/web/app/api/byok/{encrypt,proxy,revoke,status}/route.ts` — key client-held, prompts transit
the server; never claim air-gap); `apps/web/app/api/manifest/generate/local/route.ts:127-129`
(`preferLocal` falls back to cloud server-side); client BYOK producer
`apps/web/features/governance-assistant/hooks/useCloudLlm.ts:124-125`.

---

## Phase 2 — Platform & revenue (8–12 wks; gated on Phase 1 gate + D-3 = business + D-4 ADR)

Key seams, all verified: accounts layer onto `apps/web/app/lib/auth.ts` (49 lines, GitHub provider,
JWT-only, no adapter; `apps/web/app/api/auth/[...nextauth]/route.ts`); server persistence implements
`packages/shared/src/application/ports/saved-projects-persistence.port.ts` (5 methods; existing
impls `apps/web/app/lib/adapters/idb-saved-projects.adapter.ts` — write queue at `:484-489` — and
`packages/web-driver/src/infrastructure/adapters/local-storage-saved-projects.adapter.ts`; only 15
direct call sites in 4 files, wired via `apps/web/app/lib/wire.client.ts` /
`app/hooks/useSavedProjects.ts`); replace the 501 stub at
`apps/web/app/api/projects/[projectId]/route.ts:21-29,49-57`; schema/migrations
`packages/shared/src/domain/saved-project.ts:33` (v4) +
`packages/web-driver/src/infrastructure/migration/saved-projects-*.ts`; stores/limits pattern
`apps/web/lib/quota-store.ts`, `apps/web/lib/byok-store.ts`, `apps/web/lib/rate-limiter.ts`
(per-process Map — move to DB if replicas >1), `apps/web/app/lib/request-guards.ts`; import
fidelity `apps/web/app/lib/imported-manifest.ts` (fail-closed bypass to replace with lossless
parsing); deploy topology per D-4 ADR (`k8s/deployment.yaml:10` vs `deploy/docker-compose.prod.yml`).

---

## PR conventions for every phase

Small PRs per runbook item; branch per item; PR body states the runbook item, the failing-first
test evidence, and the gate + suite count. No release tags. Licensing/packaging changes
(`LICENSE` files, `package.json` license fields, `scripts/prepare-publish-package.js:217-225`
fallback, `.github/workflows/publish.yml`, `packages/sync/README.md:227`,
`tools/arch-linter/README.md:183`, root `README.md:373-385`) only per the D-1/D-2 ADRs, and flag
them release-gated for additional consideration — the relicense applies from the next release
actually published (≤0.9.0 stays evaluation-licensed forever).
