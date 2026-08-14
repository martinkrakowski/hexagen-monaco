# Coverage

What this review examined, what it skipped, and why.

Review date: 2026-08-13. Inventory command:
`python3 /tmp/hexagen-inventory.py` (scans `apps/`, `packages/`, `tools/`;
skips `node_modules`, `dist`, `.next`, `.claude`, coverage, playwright
reports).

---

## Reviewed

### Workspace (all 40 packages classified)

| Path | Name | Primary layer (from imports+content) | Deep-dive agent |
|------|------|--------------------------------------|-----------------|
| apps/api-gateway | `@hexagen/api-gateway` | adapter-inbound (stub) | A1-HEX-APPS |
| apps/tui | `@hexagen/tui` | adapter-inbound | A1-HEX-APPS, A3 |
| apps/web | `web` | composition-root + UI | A1-HEX-APPS, A2-GOD-WEB, A3 |
| packages/agentic-interaction | `@hexagen/agentic-interaction` | mixed hexagonal | A1-HEX-AI, A2-GOD-PKG, A4 |
| packages/ai-pipeline | `@hexagen/ai-pipeline` | mixed hexagonal | A1-HEX-AI, A4 |
| packages/architectural-enforcement | `@hexagen/architectural-enforcement` | empty scaffold | A1-HEX-APPS, A5 |
| packages/byok | `@hexagen/byok` | mixed hexagonal | A1-HEX-CORE |
| packages/code-generation | `@hexagen/code-generation` | empty scaffold | A1-HEX-APPS, A5 |
| packages/core-domain | `@hexagen/core-domain` | shared-kernel (MVK) | A1-HEX-KERNEL, A5 |
| packages/deployment | `@hexagen/deployment` | empty scaffold | A1-HEX-APPS |
| packages/eslint-plugin-ui | `@hexagen/eslint-plugin-ui` | toolchain | A1-HEX-APPS, A4 |
| packages/external-integration | `@hexagen/external-integration` | mixed hexagonal | A1-HEX-INFRA |
| packages/governance | `@hexagen/governance` | mixed hexagonal | A1-HEX-KERNEL |
| packages/intent-compiler | `@hexagen/intent-compiler` | mixed hexagonal | A1-HEX-APPS |
| packages/layout-engine | `@hexagen/layout-engine` | mixed hexagonal | A1-HEX-APPS |
| packages/llm-driver | `@hexagen/llm-driver` | mixed hexagonal | A1-HEX-PROJ, A4 |
| packages/local-llm | `@hexagen/local-llm` | mixed hexagonal | A1-HEX-AI |
| packages/manifest-generation | `@hexagen/manifest-generation` | mixed hexagonal | A1-HEX-PROJ |
| packages/mcp-server | `@hexagen/mcp-server` | mixed hexagonal | A1-HEX-INFRA, A2-GOD-PKG, A5 |
| packages/messaging | `@hexagen/messaging` | mixed hexagonal | A1-HEX-INFRA |
| packages/model-settings | `@hexagen/model-settings` | ui | A1-HEX-PROJ, A3 |
| packages/monaco-orchestration | `@hexagen/monaco-orchestration` | mixed hexagonal | A1-HEX-CORE |
| packages/persistence | `@hexagen/persistence` | empty scaffold | A1-HEX-APPS |
| packages/project-configuration | `@hexagen/project-configuration` | mixed hexagonal | A1-HEX-CORE, A5 |
| packages/project-generation | `@hexagen/project-generation` | mixed hexagonal | A1-HEX-CORE |
| packages/prompt-compiler | `@hexagen/prompt-compiler` | mixed hexagonal | A1-HEX-AI |
| packages/reconciliation-engine | `@hexagen/reconciliation-engine` | mixed hexagonal | A1-HEX-AI |
| packages/report-governance | `@hexagen/report-governance` | mixed hexagonal | A1-HEX-APPS |
| packages/runtime | `@hexagen/runtime` | shared-kernel | A1-HEX-KERNEL |
| packages/security | `@hexagen/security` | mixed hexagonal (orphan) | A1-HEX-KERNEL, A5, A4 |
| packages/shared | `@hexagen/shared` | shared-kernel | A1-HEX-KERNEL |
| packages/sync | `@hexagen/sync` | mixed + CLI | A1-HEX-INFRA, A2-GOD-PKG, A5 |
| packages/template-engine | `@hexagen/template-engine` | mixed + templates | A1-HEX-INFRA |
| packages/transaction-system | `@hexagen/transaction-system` | mixed hexagonal (frozen, implemented) | A1-HEX-APPS |
| packages/ui | `@hexagen/ui` | ui | A1-HEX-PROJ, A3 |
| packages/ui-projection-compiler | `@hexagen/ui-projection-compiler` | mixed hexagonal | A1-HEX-APPS, A4 |
| packages/visualization | `@hexagen/visualization` | mixed hexagonal | A1-HEX-PROJ |
| packages/web-driver | `@hexagen/web-driver` | mixed hexagonal | A1-HEX-PROJ |
| packages/wizard-orchestration | `@hexagen/wizard-orchestration` | mixed hexagonal | A1-HEX-CORE, A2-GOD-PKG |
| tools/arch-linter | `@hexagen/arch-linter` | toolchain | A1-HEX-APPS, A2-GOD-PKG, A4 |

Package count = **40** (hard-stop is `>40`). Proceeded.

### Deterministic scans (orchestrator, not delegated)

| Scan | Command / method | Used for |
|------|------------------|----------|
| Workspace graph | `find apps packages tools -maxdepth 2 -name package.json` | inventory |
| Domain import specifiers | `rg -o … **/src/domain/** from '…'` | classification |
| Empty barrels | `rg '^export \{\s*\}' **/src/**/*.ts` | HEX-025 |
| Port name collisions | Python `export (interface\|type) (\w*Port)` | HEX-005–008 |
| `new InMemoryTransactionManager` | `rg` across repo | HEX-010, HEX-003 |
| CI Node versions | read `.github/workflows/{capstone,sync-integrity,publish,deploy}.yml` | toolchain floor |
| tsconfig outliers | parse all `tsconfig*.json` excluding `.claude/worktrees` | MOD-005, MOD-006 |
| File metrics | `/tmp/hexagen-inventory.py` (LOC, exports, imports, brace depth, CC keywords, fan-in/out) | A2 candidate list |

Source files scanned for metrics: **2644** (2103 non-test).

### Bounded contexts

All 34 `bounded_contexts` in `.architecture/manifest.yaml` were mapped to
packages. Apps `web`, `api-gateway`, `tui` listed under `apps:`.

---

## Sampled rather than exhaustively read

These areas were in scope but only via hottest-file / grep, not
line-by-line:

- `apps/web/features/governance-assistant/` (98 files) — panel + types +
  LocalMode* (A3). Remaining cards/hooks not individually reviewed.
- `apps/web/features/workspace-shell/` (81 files) — `usePlanningSession`
  and export consumers. Other panes sampled via imports only.
- `apps/web/features/project-wizard/` (76 files) — generated
  `template-questions.generated.ts` (1097 loc, cc 1) skipped as generated
  data. Wizard step components not individually decomposed.
- `packages/sync/src/generators/` and `refactoring/refactoring-patterns/`
  — high CC files noted in inventory; only `refactoring-impact.use-case.ts`
  and `FileSystemPort` taken as findings.
- `packages/template-engine/templates/**` — Adobe/LLM domain→infra import
  and AgentRuntimePort location. Other templates not individually audited.
- `packages/mcp-server` tool use-cases (22) — typed as a cluster (HEX-019),
  not each tool reviewed.
- `packages/byok`, `packages/messaging`, `packages/report-governance`,
  `packages/reconciliation-engine`, `packages/web-driver` — classified and
  grepped for domain→infra / framework leaks; no additional evidenced
  findings survived silence-or-evidence.

---

## Skipped (and why)

| Area | Why |
|------|-----|
| `**/dist/**`, `**/.next/**`, root `dist/` | Compiled output; never-edit |
| `.claude/worktrees/**` | Agent worktrees; not the main graph |
| `node_modules/**` | Package manager |
| `generator.config.yaml` | Runtime state; never-edit |
| `packages/template-engine/src/infrastructure/generated/template-bundle.generated.ts` as a *second* port owner | Mirror of templates; HEX-001 cites the template source |
| Test-only `PlaceOrderPort` / `RestControllerPort` | Fixtures, not production ownership |
| DESIGN.md token / Tailwind audit | Out of the four axes; UI axis was decomposition + presentation-only |
| e2e / Playwright specs | Not hexagonal or god-structure evidence |
| k8s/, deploy/, Dockerfile | Ops, not ports-and-adapters |
| docs/planning/** | Historical plans, not current code |
| Per-file metrics for generated wizard catalogs | One reason to change (data regen); size is not a smell |
| Raising `lib` to ES2024/2025 | No finding had a non-style benefit |

---

## Agent evidence quality

| Agent | Findings returned | Missing path:line | Source edits |
|-------|-------------------:|-------------------:|--------------|
| A1-HEX-KERNEL | 7 | 0 | none |
| A1-HEX-CORE | 8 | 0 | none |
| A1-HEX-AI | 8 | 0 | none |
| A1-HEX-INFRA | 8 | 0 | none |
| A1-HEX-PROJ | 7 | 0 | none |
| A1-HEX-APPS | 8 | 0 | none |
| A2-GOD-PKG | 6 | 0 | none |
| A2-GOD-WEB | 7 | 0 | none |
| A3-REACT | 8 | 0 | none |
| A4-MODERN | 8 | 0 | none |
| A5-OWN | 8 | 0 | none |
| **Total raw** | **83** | **0 (0%)** | **none** |

Hard-stop threshold is `>30%` unevidenced. Did not trigger.

Reconciled to **64** findings in `findings.json` (dedup + axis merge).
No unresolved contradictory architecture claims.

---

## Inventory artifacts

- `inventory.json` — workspace graph, toolchain floor, layer
  classifications, cross-context edges, per-file metrics.
- `findings.json` — machine-readable reconciled findings.
- Classification is from **imports and content**, not folder names.
  Folder/content mismatches are flagged (HEX-025 and per-file
  `naming_content_mismatches` in inventory).
