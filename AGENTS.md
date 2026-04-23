# AGENTS.md — HexaGen Monaco

> Update this file only when a mode trigger changes or a new never-edit file is added.
> Detailed specs live in `.agents/` — see links in each mode entry.

---

## Before Every Exchange

Declare your mode at the top of every response. Then:

```bash
yarn build && yarn typecheck && yarn lint
```

If any command fails — **STOP**. Fix existing errors before writing anything new.

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

**Triggers:** "delegate", "orchestrate", "work plan", or any request spanning >1 Hexagonal layer or >1 package.

**Full spec:** [`.agents/ORCHESTRATOR.md`](.agents/ORCHESTRATOR.md)

**Rule:** Never write implementation code in this mode. Decompose → emit Work Plan → delegate → gate.

**Delegation process:** For each sub-task in the Work Plan, use the **Task tool** to instantiate the sub-agent:

1. Identify the Sub-Agent role (Domain Worker, Adapter Worker, Test/QA Worker) — see `.agents/ORCHESTRATOR.md` §Sub-Agent Roles
2. Use the **Task tool** with `subagent_type: "general"` or `"explore"` depending on scope
3. Inject the **Global Governance block** (see `.agents/ORCHESTRATOR.md` §Step 4)
4. Append the sub-agent's specific task description and Work Plan row
5. Do **not** proceed to dependent tasks until sub-agent output is received

Ends with: **Ready to emit Work Plan. Confirm scope or say `delegate [feature]` to proceed.**

### 🧠 Brainstorm Mode

**Triggers:** "brainstorm", "explore", "what if", open conceptual questions.
**Rule:** No code, no file paths, no implementation decisions. Surface options; do not converge.

### 🏗️ Architect Mode

**Triggers:** "architect", "design", "plan", "update manifest.yaml", structural decisions.
**Deliverables:** Changed `manifest.yaml` snippet · bounded context definition · Mermaid diagram (if >2 parts) · folder structure · dependency flow · wiring strategy.
**Validation:** Confirm bootstrap precondition order · failure behaviour per priority · diagram nodes match YAML · no port in >1 context.
Ends with: **Ready to move to Develop mode when you say `develop [feature]`.**

### 🔨 Develop Mode

**Triggers:** "develop [feature]", "implement", "code", "next step", "batch phase".

**Full spec:** [`.agents/TESTING.md`](.agents/TESTING.md)

1. Verify clean build before writing anything.
2. Print a numbered ToC of all files to create/modify first.
3. **One file per response** — full content, no ellipsis. _(Override: "batch Phase X" authorises multi-file streaming.)_
4. Pause after every file and await "next step". _(Override: no pause when batching is authorised.)_
5. Every file maps to a named element in `manifest.yaml`. Update manifest + run `yarn lint:arch` before any implementation file when adding a port/use-case/entity.
6. After each port + adapter + test double slice: remind to run `yarn build && yarn sync`.
7. Never leave a barrel with only `export {}`.
8. Minimal scoped changes only — no cosmetic reformatting.
9. For features spanning >1 phase: stop after each phase, provide a summary table, await confirmation.
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

**Full spec:** [`.agents/yaml-editing-disciplines.md`](.agents/yaml-editing-disciplines.md)

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

| Package    | Resolution | Extension handling                       |
| ---------- | ---------- | ---------------------------------------- |
| sync (CLI) | NodeNext   | Explicit `.js` extensions required       |
| All others | bundler    | Extensionless or `.js` via webpack alias |
