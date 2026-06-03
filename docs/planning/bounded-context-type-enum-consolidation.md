# Bounded-Context-Type Enum — Residual Drift Remediation Plan

Follow-up to the `/projects/new` regression remediation (PR #197 fixed
`@hexagen/project-configuration`; **PR #201** introduced the single source in
`@hexagen/shared`). This plan covers the surfaces #201 deliberately left out of
scope — the remaining copies of the bounded-context-type set that still drift
from the canonical.

References use durable locators (file + symbol / search hint), not line numbers.

## Canonical (post-#201)

`@hexagen/shared` (`src/domain/bounded-context-type.ts`) is the single source:

- `BOUNDED_CONTEXT_TYPES` — `["core","supporting","generic","shared-kernel","driver"]`
- `BoundedContextType` — the union type
- `boundedContextTypeSchema` — case-insensitive (trim + lowercase) Zod schema

Every package already depends on `@hexagen/shared`, so all the surfaces below can
import from it. **All phases here depend on #201 being merged.**

## The residual drift

`grep -rn '"core", "supporting", "generic", "shared-kernel"'` (and the
`core|supporting|generic|shared-kernel` prompt variants) surfaces three classes
of remaining copies, none reached by #201:

| PR       | Phase | Surface                                                                  | Severity               | Blast radius            |
| -------- | ----- | ------------------------------------------------------------------------ | ---------------------- | ----------------------- |
| **PR A** | P2    | MCP tool-param enums + handler casts (missing `driver`)                  | Low (input surface)    | mcp-server (2 tools)    |
| **PR B** | P2    | LLM prompts disagree on the type set (internally inconsistent)           | Low–Med (needs a call) | agentic-interaction     |
| **PR C** | P3    | `shared` vs `agentic-interaction` `manifest-draft.schema.ts` duplication | Med (refactor)         | 2 packages, ~12 exports |

These are independent. PR A is mechanical. PR B is blocked on a product decision
(below). PR C is a standalone refactor that needs a usage audit first.

---

## Prerequisite decision — what is a `"driver"` context, and is it LLM-emittable?

`"driver"` is a valid bounded-context type in the final schema (project-config,
agentic topology draft) but **has no definition anywhere** — the classify system
prompt (`classify-context-type.prompt.ts`) defines only `core` / `supporting` /
`generic` / `shared-kernel`. Worse, `generate-manifest.prompt.ts` is internally
inconsistent: its stage-2 rule ("`contextType` is required … must be: core,
supporting, generic, shared-kernel, **driver**") **includes** `driver`, while the
compact stage-2 instruction string ("`contextType (core|supporting|generic|shared-kernel)`")
**omits** it.

So before PR B, decide:

- **(Recommended) `driver` is LLM-emittable.** One prompt spot already says so;
  treat the omissions as drift. Then PR B must also **add a one-line `driver`
  definition** to the classify prompt (what distinguishes a driver context),
  otherwise the model can emit a type it was never taught.
- **`driver` is config-only** (set via structured-config import / manual edit,
  never classified). Then PR B removes `driver` from the stage-2 _rule_ too and
  we document `driver` as non-LLM. (Note: #201 already made the classify
  _schema_ accept `driver`; that stays harmless either way — schema ⊇ prompt.)

This is a DDD/product call. The rest of PR B is mechanical once it's made.

---

## PR A — MCP tool params accept the full type set (· P2, low risk)

**Root cause.** Two MCP tools hardcode the 4-value set in both their JSON
`inputSchema` enum and a handler cast, so an MCP client cannot pass `driver`:

- `scaffold-module.ts` (`scaffoldModuleTool`) — `inputSchema.properties.context_type.enum`
  - the `context_type` cast in `handler`.
- `create-context.ts` (`createContextTool`) — `inputSchema.properties.type.enum`
  - the `type` cast in `handler`.

**Fix.** `@hexagen/mcp-server` already depends on `@hexagen/shared`, so source
the values from the canonical: `enum: [...BOUNDED_CONTEXT_TYPES]` and cast to
`BoundedContextType` (drop the inline 4-value unions). This adds `driver` and
prevents future drift in one move.

**Files.** `packages/mcp-server/src/infrastructure/adapters/tools/scaffold-module.ts`,
`.../create-context.ts`. Check the two use-cases behind them
(`scaffoldModuleToolUseCase`, `createContextToolUseCase`) for further 4-value
casts and widen those to `BoundedContextType` too.

**Tests.** mcp-server tool-definition test (if present) asserting the tool's
enum includes every `BOUNDED_CONTEXT_TYPES` value; otherwise a small unit test.

**Risk.** Low — purely widens an input enum. Confirm downstream handlers don't
`switch` exhaustively on the 4 values (typecheck will flag if they do).

**Acceptance.** `hexagen_create_context` / `hexagen_scaffold_module` accept
`type/context_type: "driver"`; enum is sourced from `BOUNDED_CONTEXT_TYPES`.

---

## PR B — Make the generation/classify prompts agree on the type set (· P2)

**Blocked on the prerequisite decision above.**

**Root cause.** The bounded-context-type set is hand-written into several prompt
strings that have drifted from each other and from the schema:

- `classify-context-type.prompt.ts` — `CLASSIFY_CONTEXT_TYPE_SYSTEM_PROMPT`
  (the "classify it as one of: …" line, the `Definitions:` block, and the
  `Output JSON only: {"type": "…"}` hint) — 4 values, no `driver` definition.
- `generate-topology.prompt.ts` — the `Rules:` line `type must be one of: …` — 4 values.
- `generate-manifest.prompt.ts` — the stage-2 _rule_ string **has** `driver`;
  the compact stage-2 instruction string **omits** it (internal contradiction);
  and `compilePortsPrompt` casts `contextType as "core"|…|"shared-kernel"`
  (missing `driver` — use `BoundedContextType`).

**Fix.** Per the decision: make every prompt mention list the same set, and add
the `driver` definition if we keep it LLM-emittable. Prompts are string
literals, so they can't import the enum directly; to keep them honest, derive
the human-readable list from `BOUNDED_CONTEXT_TYPES` (e.g. a small
`BOUNDED_CONTEXT_TYPES.join(", ")` helper interpolated into the templates)
rather than re-typing it. Fix the `compilePortsPrompt` cast to `BoundedContextType`.

**Files.** `packages/agentic-interaction/src/domain/prompts/classify-context-type.prompt.ts`,
`generate-topology.prompt.ts`, `generate-manifest.prompt.ts`.

**Tests.** Assert each compiled prompt mentions every `BOUNDED_CONTEXT_TYPES`
value (guards against re-drift). Update existing prompt-generation tests
(`packages/agentic-interaction/__tests__/prompt-generation.test.ts`) for the new
wording.

**Risk.** Low–Med — prompt wording changes can shift LLM output. Exercise the
full AI flow (dev env is OpenRouter) before/after. Adding a never-defined type
to the classify prompt without a definition is the main footgun — hence the
prerequisite.

**Acceptance.** Every prompt that enumerates context types lists the canonical
set; no internal contradiction within `generate-manifest.prompt.ts`; the
`compilePortsPrompt` cast uses `BoundedContextType`.

---

## PR C — Reconcile (or document) the duplicated `manifest-draft.schema` (· P3)

**Root cause.** `packages/shared/src/domain/manifest/manifest-draft.schema.ts`
and `packages/agentic-interaction/src/domain/manifest/manifest-draft.schema.ts`
duplicate ~12 exports with the **same names** (`ManifestDraftPortSchema`,
`ManifestDraftAdapterSchema`, `ManifestDraftContextSchema`,
`ManifestTopologyDraftContextSchema`, `createManifestDraftSchema`,
`ManifestDraftSchema`, `createManifestTopologyDraftSchema`,
`ManifestTopologyDraftSchema`, `createContextListSchema`, `ContextListSchema`,
`PortsListEntrySchema`, `PortsListSchema`) but have **diverged**: shared uses
`MAX_BOUNDED_CONTEXTS_DRAFT = 10`; agentic uses `5` and adds
`ManifestDraftContextMappingSchema`, plus `contextMappings`/`apps` on the draft
schema. #201 unified only the `type` field across both (via
`boundedContextTypeSchema`); the surrounding schemas are still two copies.

**Fix (audit first).**

1. **Usage audit.** `grep` importers of each file's exports. Determine whether
   anyone imports the _shared_ copy at all (the main `@hexagen/shared` index does
   **not** currently re-export `domain/manifest/*` — see the sync note below), or
   whether agentic-interaction's copy is the only one in real use.
2. Then either:
   - **Unify** into `@hexagen/shared`, parameterizing the differences (max count;
     optional `contextMappings`/`apps`/mapping schema), and have
     agentic-interaction import them; **or**
   - **Delete the dead copy** if the audit shows one is unused; **or**
   - **Document the intentional divergence** (different draft shapes per stage)
     with a comment cross-linking the two, if both are genuinely needed as-is.

**Files.** the two `manifest-draft.schema.ts` files (+ importers found in the audit).

**Risk.** Med — these schemas validate LLM output mid-pipeline; subtle shape
differences (`.strict()`, extra fields, max) matter. Do not unify blindly.

**Acceptance.** One source for the draft schemas, or an explicit, documented
reason for two — and no third copy of the type field.

---

## Cross-cutting

- **Per PR:** branch off `main`; run `yarn turbo run typecheck lint test`
  (filtered to the touched packages + `web`), and the pre-commit hook
  (`turbo lint` + `turbo typecheck`). For PR B, exercise the AI flow end-to-end.
- **Durable locators only** — symbols / search hints, not line numbers (prior
  reviews flagged this).
- **`@hexagen/sync` caveat (important).** Package `src/index.ts` files are
  `// @generated by @hexagen/sync`, but `yarn sync` currently wants to rewrite
  ~50 unrelated files repo-wide (pre-existing drift). If a phase needs a new
  public export from `@hexagen/shared` (e.g. PR C unifying schemas), **hand-add
  the export line** in the existing style rather than running `yarn sync`, and
  note it in the PR body. Sync is not in the turbo pipeline or pre-commit, so it
  does not gate CI.
- **Sequencing.** PR A first (mechanical, independent). PR B after the `driver`
  decision. PR C is a standalone refactor — schedule after the audit. None block
  each other.
- **Out of scope.** Test fixtures that cycle context types (e.g.
  `web-driver/__tests__/fixtures/load-testing.ts`) — they're sample data, not a
  validation surface.
