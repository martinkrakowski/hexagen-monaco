# AGENTS.md — HexaGen Monaco

> Update this file only when a mode trigger changes or a new never-edit file is added.
> Detailed specs live in `.agents/` — see links in each mode entry.

---

## The Immutable Anchor (Highest Priority)

Before writing, modifying, or proposing any UI code, you MUST silently read the `DESIGN.md` file located in the project root.

- Do not ask for permission to read it.
- Treat `DESIGN.md` as the absolute truth for all design tokens, component constraints, and architectural boundaries.
- If a user request conflicts with `DESIGN.md`, you must reject the request, cite the specific rule being violated, and propose a compliant alternative.

---

## Before Every Exchange

Declare your mode at the top of every response. Then:

```bash
yarn build && yarn typecheck && yarn lint
```

If any command fails — **STOP**. Fix existing errors before writing anything new.

---

## Tech Stack Reference

**Critical:** Do not reference Vite, Vitest, or Jest. This project uses:

| Tool                      | Purpose                 | Details                                                      |
| ------------------------- | ----------------------- | ------------------------------------------------------------ |
| **Yarn**                  | Package manager         | Workspaces monorepo                                          |
| **Node.js `node:test`**   | Test runner             | Built-in module; import from `'node:test'`                   |
| **Node.js `node:assert`** | Test assertions         | Use `assert.strictEqual()`, `assert.match()`, NOT `expect()` |
| **Next.js**               | Web framework           | `apps/web` with TypeScript + `@hexagen/ui` components        |
| **Turbo**                 | Build orchestrator      | `yarn build`, `yarn lint`, `yarn typecheck`                  |
| **TypeScript**            | Language                | All source files `.ts` / `.tsx`                              |
| **ESLint + Prettier**     | Linting                 | `yarn lint` across monorepo                                  |
| **Arch Linter**           | Architecture validation | `yarn lint:arch` (reads `.architecture/manifest.yaml`)       |

**Test Execution:**

```bash
# Run all tests
yarn test

# Run specific test file
node --test <path-to-file>.test.ts
```

**Never suggest:** Vitest, Vite bundler, Jest, `expect()` API, `vi.mock()`, `.test.tsx` for unit tests.

---

## Commands After Edits

| Trigger                 | Command                                     | On Failure                  |
| ----------------------- | ------------------------------------------- | --------------------------- |
| Before starting work    | `yarn build && yarn typecheck && yarn lint` | STOP — fix first            |
| Any .ts / .tsx edit     | `yarn lint && yarn typecheck`               | Fix before continuing       |
| Any .architecture/ edit | `yarn lint:arch`                            | STOP — do not proceed       |
| After `yarn sync`       | `yarn build && yarn typecheck`              | Fix before committing       |
| Before committing       | `yarn test`                                 | Diagnose — never skip tests |

**Clean CI simulation:**

```bash
rm -rf packages/*/dist .turbo node_modules/.cache
find . -name "*.tsbuildinfo" -delete
yarn build && yarn typecheck
```

---

## Files Never Edit

| Path                    | Reason                       |
| ----------------------- | ---------------------------- |
| `generator.config.yaml` | Runtime state — event-driven |
| `**/dist/**`            | Compiled output              |
| `**/*.tsbuildinfo`      | TS incremental cache         |
| `**/src/**/*.d.ts`      | Must not exist in src/       |
| `**/node_modules/**`    | Package manager controlled   |
| `yarn.lock`             | Package manager controlled   |
| `turbo.json`            | Use `--force-root` if needed |
| `.gitignore`            | Use `--force-root` if needed |

To modify a protected file: state reason → get human confirmation → use `yarn sync --force-root`.

---

## Operating Modes

### 🎯 Orchestrator Mode

**Triggers:** "delegate", "orchestrate", "work plan", or any request spanning \>1 Hexagonal layer or \>1 package.

**Full spec:** [`.agents/ORCHESTRATOR.md`](https://www.google.com/search?q=.agents/ORCHESTRATOR.md)

**Rule:** Never write implementation code in this mode. Decompose → emit Work Plan → delegate → gate.

**Delegation process:** For each sub-task in the Work Plan, use the **Task tool** to instantiate the sub-agent:

1.  Identify the Sub-Agent role (Domain Worker, Adapter Worker, Test/QA Worker) — see `.agents/ORCHESTRATOR.md` §Sub-Agent Roles
2.  Use the **Task tool** with `subagent_type: "general"` or `"explore"` depending on scope
3.  Inject the **Global Governance block** (see `.agents/ORCHESTRATOR.md` §Step 4)
4.  Append the sub-agent's specific task description and Work Plan row
5.  Do **not** proceed to dependent tasks until sub-agent output is received

Ends with: **Ready to emit Work Plan. Confirm scope or say `delegate [feature]` to proceed.**

### 🧠 Brainstorm Mode

**Triggers:** "brainstorm", "explore", "what if", open conceptual questions.
**Rule:** No code, no file paths, no implementation decisions. Surface options; do not converge.

### 🏗️ Architect Mode

**Triggers:** "architect", "design", "plan", "update manifest.yaml", structural decisions.
**Deliverables:** Changed `manifest.yaml` snippet · bounded context definition · Mermaid diagram (if \>2 parts) · folder structure · dependency flow · wiring strategy.
**Validation:** Confirm bootstrap precondition order · failure behaviour per priority · diagram nodes match YAML · no port in \>1 context.
Ends with: **Ready to move to Develop mode when you say `develop [feature]`.**

### 🔨 Develop Mode

**Triggers:** "develop [feature]", "implement", "code", "next step", "batch phase".

**Full spec:** [`.agents/TESTING.md`](https://www.google.com/search?q=.agents/TESTING.md)

1.  Verify clean build before writing anything.
2.  Print a numbered ToC of all files to create/modify first.
3.  **One file per response** — full content, no ellipsis. _(Override: "batch Phase X" authorises multi-file streaming.)_
4.  Pause after every file and await "next step". _(Override: no pause when batching is authorised.)_
5.  Every file maps to a named element in `manifest.yaml`. Update manifest + run `yarn lint:arch` before any implementation file when adding a port/use-case/entity.
6.  After each port + adapter + test double slice: remind to run `yarn build && yarn sync`.
7.  Never leave a barrel with only `export {}`.
8.  Minimal scoped changes only — no cosmetic reformatting.
9.  For features spanning \>1 phase: stop after each phase, provide a summary table, await confirmation.
10. After review approval: `git commit` with a descriptive message. Never `git push` without explicit instruction.

### 🔍 Review & Archeology Mode

**Triggers:** "review", "analyze", "critique", "check this code", "why was this added", "history of".
**Rule:** Read-only — no edits, no code generation.
**Output:** Structured critique: **Critical Violations** and **Architectural Smells**.
**Archeology:** Trace origin commit → cross-reference ADRs in `.architecture/decisions/` → classify as Bug-fix Invariant or Legacy Debt.

```bash
git log --all --full-history --oneline -- "path/to/file"
git log -p --all -S 'string' -- "path/to/file"
git show <commit-hash>:path/to/file
```

Ends with: **Ready to move to Develop mode when you say `develop [feature]`.**

---

## YAML Editing Discipline

**Full spec:** [`.agents/yaml-editing-disciplines.md`](https://www.google.com/search?q=.agents/yaml-editing-disciplines.md)

When editing `.architecture/manifest.yaml` or `.architecture/invariants/linter-config.yaml`:

- Run `grep -n "^  - name:\|^- name:" <file>` to confirm indentation pattern before editing
- Match indentation exactly — YAML is whitespace-sensitive
- Validate after every edit: `python3 -c "import yaml; yaml.safe_load(open('.architecture/manifest.yaml'))" && echo OK`
- Then run `yarn lint:arch`

---

## Interaction Protocol

| Intent                        | Command                                        |
| ----------------------------- | ---------------------------------------------- |
| Trigger orchestration         | `delegate [feature]` / `orchestrate [feature]` |
| Emit Work Plan only           | `work plan [feature]`                          |
| Advance development           | `next step`                                    |
| Reject a proposal             | `reject this approach`                         |
| Open a design question        | `brainstorm [topic]`                           |
| Authorise multi-file batching | `batch Phase X files`                          |
| Confirm Quality Gate pass     | `gate passed`                                  |

---

## Appendix: Module Resolution

**Policy:** Dual-resolution architecture based on deployment target.

**Codified in:** `.architecture/decisions/ADR-0009-published-cli-bundling.md`

| Package                         | Resolution         | Extension Handling              | Rationale                                                                                             |
| ------------------------------- | ------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@hexagen/sync` (published CLI) | `bundler` (source) | Inlined via `tsup` → ESM bundle | Published npm package consumed by Node.js; `tsup` bundles workspace deps into self-contained artifact |
| All other packages              | `bundler`          | Extensionless via webpack alias | Consumed by `apps/web` (Next.js webpack context) or internal monorepo use                             |

**Key Implementation Notes:**

- `@hexagen/sync` uses `tsup` for build (not `tsc`). See `.architecture/decisions/ADR-0009-published-cli-bundling.md` for rationale.
- Source code in `@hexagen/sync` and dependencies remains `bundler`-resolved during development.
- `tsup` handles ESM transpilation and extension normalization at publish-time.
- All _source_ files in the monorepo use `bundler` resolution (AGENTS.md §Operating Modes).
- Transitive workspace dependencies (`@hexagen/governance`, `@hexagen/project-configuration`, etc.) are inlined into the `@hexagen/sync` bundle, not published separately.

**Why Not Monorepo-Wide NodeNext?**

Originally proposed (Phases 1–5 work). Rejected in favor of targeted bundling because:

1. Reverses established policy without deployment justification
2. 900-file refactor; high review risk
3. Transitive dependency fragility for external consumers
4. Industry precedent: published CLIs use bundling, not module-resolution config flips
5. Preserves AGENTS.md dual-resolution policy (correct for this deployment profile)

See ADR-0009 for full decision record.
