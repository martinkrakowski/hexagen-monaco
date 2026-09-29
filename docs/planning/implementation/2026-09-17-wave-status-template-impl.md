# Wave-Status Add-On (template series #19) — Implementation Plan

**Date:** 2026-09-17
**Source plan:** `docs/planning/generator-templates/19-wave-status.md` (PR #678)
**Status:** implementable independently of the gates work, after two amendments
**Verified against:** `main` at `732e9591`
**Review:** Fable and grok-4.6 independently; both place it as orthogonal to the other three.

---

## 0. Placement

This is a **fifth add-on**, not a gate. It ships the wave-observability tooling the orchestration
emits (`events.jsonl` and a reader over it) into a generated project. It is neither blocked by nor
blocking G1–G5, and it should not be sequenced behind them.

One thing it is **not**: a substitute for the gates. It observes waves; it does not defend a
project.

---

## 1. Two amendments, both verified

### A. "Append to AGENTS.md" has no engine support — the promise cannot be kept

The source plan lists an output as an `AGENTS.md § Wave Observability` section, "append only".

```
grep -rn append packages/template-engine/src/domain packages/template-engine/src/application → empty
file-emitter.adapter.ts:147 + conflict-path.ts:27-32  → collision becomes <name>.hexagen-update.<ext>
templates/agents-md/manifest.json:32                  → agents-md already outputs AGENTS.md
```

There is **no append mode in the emitter**. On any project that has `AGENTS.md` — which is every
project that installed `agents-md` — this output lands as `AGENTS.hexagen-update.md`, and the
promised "full emit-shape test" cannot assert an append that does not exist.

**Amendment:** emit `.agents/wave-observability.md` as its own file and put a pointer in the
template's `checklist`. Declare the relationship to `agents-md` explicitly in the manifest
(`requires` or `conflicts`, whichever matches the intended composition).

Adding an append output mode to the engine is a **core change and is out of scope here** — if it
is wanted, it is its own lane with its own plan.

### B. "Tests at the project's coverage bar" is false twice over

```
root-files.ts:48          generated workspaces default to ["apps/*", "packages/*"]
root-file-templates.ts:19 emitted `test` is `turbo test`
```

`tools/wave-status/__tests__` sits **outside every workspace glob**, so `turbo test` runs it in a
generated project — never. The D102 trade-off the source plan accepts ("a broken dev tool blocks a
product PR") therefore never materialises, and the tests it promises are dead on arrival.

And there is **no coverage bar to run at**: no generated project emits a coverage threshold
(verified — `grep -rn coverage packages/sync/src/generators` hits only a `.gitignore` line). The
gates plan's G2 would create one, and this plan must not assume it.

**Amendment:** either place the tool inside a workspace glob, or add a root script the emitted
`test` reaches. State which, and drop the coverage-bar promise entirely.

---

## 2. Work Plan Table

| #   | Task                                                                | Sub-Agent      | Scope (Package · Layer)                | Mode         | Tag        | Depends On |
| --- | ------------------------------------------------------------------- | -------------- | -------------------------------------- | ------------ | ---------- | ---------- |
| 1   | Decide the tool's home: workspace member vs root-script reach       | Primary        | `templates/wave-status/`               | 🏗️ Architect | **GATE**   | —          |
| 2   | Decide composition with `agents-md` (`requires` / `conflicts`)      | Primary        | manifest                               | 🏗️ Architect | **GATE**   | —          |
| 3   | Template manifest + questions (`options`, never `choices`)          | Adapter Worker | `templates/wave-status/`               | 🔨 Develop   | SEQUENTIAL | 1, 2       |
| 4   | `files/` — the emitter, the reader, `.agents/wave-observability.md` | Adapter Worker | `templates/wave-status/files/`         | 🔨 Develop   | SEQUENTIAL | 3          |
| 5   | Emit-shape test, following the `bullmq` / `supabase` precedent      | Test/QA Worker | `template-engine/__tests__/templates/` | 🔨 Develop   | PARALLEL   | 4          |
| 6   | Add to `JOB-INDEX.md` (also correct its stale `mcp-server` row)     | Primary        | `docs/planning/generator-templates/`   | 🏗️ Architect | PARALLEL   | 3          |
| 7   | Quality Gate                                                        | Primary        | all packages                           | 🔍 Review    | **GATE**   | 4, 5, 6    |

Task 6 carries a fix grok noticed in passing: `JOB-INDEX.md` still describes `mcp-server` as
design-only, and it shipped.

---

## 3. Global Governance

The standard block, plus:

```
- A select question's field is `options`, never `choices` (question.ts:8-14).
- An add-on cannot edit package.json, tsconfig.json or .architecture/*. A template manifest has
  no `dependencies` or `scripts` field. If the tool needs a run script, that is a CORE change —
  STOP and report rather than working around it.
- There is no append mode in the emitter. A collision produces <name>.hexagen-update.<ext>.
  Do not design an output that assumes merging into an existing file.
- Do not create anything at the top level of packages/template-engine/templates/ other than the
  template directory itself: discoverTemplateIds() fails the build on a stray.
```

---

## 4. Definition of Done

Step 5 checklist, plus:

- `discoverTemplateIds()` reports **no strays** with the new template present.
- The emit-shape test asserts the exact emitted path set — **a count alone would pass with a file
  missing**.
- Emitting into a project that already has `AGENTS.md` produces **no** `.hexagen-update` sidecar,
  which is the proof that amendment A was applied rather than described.
- The generated tests are reachable by the generated project's own `test` script — demonstrated,
  not asserted. If task 1 chose the root-script route, show the script running them.
- No coverage assertion anywhere: there is no bar, and claiming one is the failure mode this plan
  was amended to remove.
