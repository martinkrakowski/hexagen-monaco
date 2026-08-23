# ORCHESTRATOR.md — HexaGen Orchestrator Spec

Loaded by the Primary agent only when `delegate`, `orchestrate`, or `work plan` is triggered.
The root `AGENTS.md` contains the one-line mode summary; this file contains the full protocol.

---

## Role

The Primary is the **Lead Architect and Orchestrator**. In this mode it never writes
implementation code. Its sole responsibilities are:

1. Decompose the request into bounded sub-tasks
2. Emit a Work Plan table
3. Inject Global Governance constraints into every sub-agent prompt
4. Execute the Quality Gate before any merge or commit

---

## Step 1 — Decompose (`super.analyze()`)

Before emitting the Work Plan, explicitly state:

- Which Bounded Context(s) in `manifest.yaml` are touched
- Which Hexagonal layers are involved (Domain / Application / Infrastructure)
- Which Turborepo packages are affected

Do **not** write any code at this step.

---

## Step 2 — Parallelisation Assessment

Classify each sub-task:

| Tag          | Meaning                                                       |
| ------------ | ------------------------------------------------------------- |
| `PARALLEL`   | No shared file — can run concurrently via Git worktree        |
| `SEQUENTIAL` | Depends on output of a prior task (e.g. port interface first) |
| `GATE`       | Must be fully reviewed by Primary before later tasks start    |

Flag any task touching a shared barrel or `tsconfig.json` as `SEQUENTIAL`.

---

## Step 3 — Work Plan Table (mandatory output)

Emit before any sub-agent is instantiated. Never skip.

```
| # | Task                       | Sub-Agent      | Scope (Package · Layer)         | Mode        | Tag        | Depends On |
|---|----------------------------|----------------|---------------------------------|-------------|------------|------------|
| 1 | Define Port interface       | Domain Worker  | @hexagen/core · Domain          | 🔨 Develop  | GATE       | —          |
| 2 | Implement Adapter           | Adapter Worker | @hexagen/infra · Infrastructure | 🔨 Develop  | PARALLEL   | Task 1     |
| 3 | Write unit tests + doubles  | Test/QA Worker | @hexagen/core · __tests__       | 🔨 Develop  | PARALLEL   | Task 1     |
| 4 | Update manifest.yaml        | Primary        | .architecture/                  | 🏗️ Architect | GATE       | Task 1     |
| 5 | Quality Gate                | Primary        | All packages                    | 🔍 Review   | GATE       | 2, 3, 4    |
```

Column definitions:

- **Task** — one sentence, verb-first
- **Sub-Agent** — which role executes it (see Sub-Agent Roles below)
- **Scope** — Turborepo package + Hexagonal layer
- **Mode** — the operating mode the sub-agent inherits
- **Tag** — PARALLEL / SEQUENTIAL / GATE
- **Depends On** — task number(s) that must complete first, or "—"

---

## Step 4 — Global Governance (inject into every sub-agent prompt)

```
[GLOBAL GOVERNANCE]
- ESM NodeNext: all imports within packages/sync/ require explicit .js extensions
- Hexagonal boundary: Domain layer must import nothing from Infrastructure
- No framework imports in domain entities or value objects
- Catch blocks must return Result<T, E> — never null / false / default
- No self-import by package name inside src/
- No .d.ts files inside src/ directories
- Barrels must not be empty (no `export {}`)
- Any new @hexagen/* import requires a matching package.json dependency update
```

Append the sub-agent's specific task description and its Work Plan row after this block.

---

## Step 5 — Quality Gate (`super.verify()`)

Non-delegatable. Primary runs this checklist after all sub-agent outputs are received.

```
[ ] yarn build && yarn typecheck && yarn lint pass clean
[ ] yarn lint:arch passes — no manifest violations
[ ] No Domain package imports an Infrastructure package
[ ] No port is declared in more than one bounded context
[ ] Every catch block returns Result<T, E>
[ ] Every context.yaml layers entry names a real exported symbol — spelled exactly as exported, owned by the context whose package defines it, declared in exactly one context (registry accuracy, ADR-0057 — completeness is NOT required). Ports and adapters are machine-checked by `lint:arch` (`context-declaration-drift`); the domain / use-case lists are warn-only, so this line still needs a human.
[ ] Test doubles implement the exact same interface as the real adapter
[ ] No barrel contains only `export {}`
[ ] git diff --stat reviewed — no unintended reformatting
```

If any item fails, re-instantiate the relevant sub-agent with a targeted fix prompt.
Do not proceed to `git commit` until all items pass.

---

## Sub-Agent Roles

### Domain Worker

**Mode:** 🔨 Develop
**Scope:** `src/domain/` subtrees only — entities, value objects, domain services, port interfaces
**Hard constraints:**

- Zero imports from any Infrastructure package
- Zero framework imports (`express`, `fastify`, `prisma`, etc.)
- Ports are TypeScript interfaces only — no implementations
- Domain errors are typed discriminated unions — never `throw new Error(string)`

**Output checklist:**

```
[ ] No infrastructure dependency (verified via yarn typecheck)
[ ] Port interface exported from correct barrel
[ ] yarn lint passes on changed files
```

---

### Adapter Worker

**Mode:** 🔨 Develop
**Scope:** `src/infrastructure/` subtrees — adapters, API routes, DB access
**Hard constraints:**

- Imports port interface from Domain — never re-declares it
- Class name convention: `<PortName>Adapter` (e.g. `ConfigRepositoryAdapter`)
- All async operations return `Result<T, E>` — no thrown exceptions escape the adapter
- Explicit `.js` extensions required in `packages/sync/` (NodeNext)

**Output checklist:**

```
[ ] Adapter implements port interface exactly (no extra public methods)
[ ] No domain types re-declared — imported from @hexagen/shared or domain package
[ ] yarn typecheck passes on changed files
```

---

### Test/QA Worker

**Mode:** 🔨 Develop
**Scope:** `__tests__/` directories — unit tests, integration tests, test doubles
**Hard constraints:**

- Test doubles implement exactly the same interface as the real adapter (parity rule)
- Every test covers: happy path + error case + at least one edge case
- No `expect(fn).not.toThrow()` — use `Result<T, E>` assertions
- Never delete or skip a test to make a suite pass

**Output checklist:**

```
[ ] Test double in __tests__/doubles/ implements port interface exactly
[ ] Happy path + error cases covered
[ ] yarn test passes for the affected package
```

---

### Primary — reserved tasks

These are **never delegated**:

| Task                                  | Reason                                    |
| ------------------------------------- | ----------------------------------------- |
| Editing `.architecture/manifest.yaml` | Single source of truth — Primary only     |
| Running `yarn lint:arch`              | Architecture validation is a gate action  |
| Running the Quality Gate checklist    | Final integrity is non-delegatable        |
| Running `git commit`                  | Version control discipline                |
| Resolving port ownership conflicts    | Cross-context decisions need full context |

---

## SyncEngine Invariants (reference)

| #   | Invariant                 | Priority | Failure         |
| --- | ------------------------- | -------- | --------------- |
| 1   | composite-safety          | critical | abort + cleanup |
| 2   | barrel-ownership-boundary | critical | abort + cleanup |
| 3   | port-single-ownership     | critical | abort + cleanup |
| 4   | dependency-consistency    | high     | abort           |
| 5   | self-import-prevention    | high     | abort           |
| 6   | signature-synchronization | high     | abort           |
| 7   | no-empty-stubs            | medium   | warn + continue |
| 8   | exports-field-mandatory   | medium   | warn + continue |
| 9   | test-double-parity        | medium   | warn + continue |

## Bootstrap Sequence (reference)

1. `load-ownership-map` (memory-only)
2. `validate-port-ownership-map` (memory-only)
3. `generate-package-skeleton`
4. `enforce-tsconfig-paths-override`
5. `generate-exports-field`
6. `synchronize-signatures`
7. `validate-barrel-chain`
8. `enforce-dependency-consistency`
9. `final-composite-reference-check`

**Failure behaviour:** critical → abort + cleanup · high → abort, leave partial state · medium → warn and continue
