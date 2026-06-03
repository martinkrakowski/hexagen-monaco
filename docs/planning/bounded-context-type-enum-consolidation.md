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

The packages in this plan (`@hexagen/mcp-server`, `@hexagen/agentic-interaction`,
`@hexagen/project-configuration`) already depend on `@hexagen/shared`, so those
surfaces can import the canonical directly. Some packages do **not** depend on it
(e.g. `@hexagen/layout-engine`, `core-domain`, `ui`); any other package the audit
touches must add the dependency first. **#201 is merged**, so the canonical is on
`main`.

## The residual drift

`grep -rn '"core", "supporting", "generic", "shared-kernel"'` (and the
`core|supporting|generic|shared-kernel` prompt variants) surfaces these classes
of remaining copies:

| PR       | Phase | Surface                                                                  | Severity               | Status                       |
| -------- | ----- | ------------------------------------------------------------------------ | ---------------------- | ---------------------------- |
| **PR A** | P2    | MCP tool-param enums + casts + use-cases/port (missing `driver`)         | Low (input surface)    | ✅ done in #201 (`d2bfda62`) |
| **(A′)** | P1    | `coerceContextType` silently mapped `driver`→`core`                      | **Med (correctness)**  | ✅ done in #201 (`d2bfda62`) |
| **(A″)** | P2    | 3 more type-position copies (an `as` cast + 2 ports) #201 missed         | Low                    | ✅ done in #203              |
| **PR B** | P2    | LLM prompts disagree on the type set (internally inconsistent)           | Low–Med (needs a call) | ⬜ open (gated)              |
| **PR C** | P3    | `shared` vs `agentic-interaction` `manifest-draft.schema.ts` duplication | Med (refactor)         | ⬜ open                      |
| **PR D** | P2    | more type-position copies — incl. a `"generic"`-dropping variant         | **Med (latent bug)**   | ⬜ open (newly found)        |

**Update (post-#201 review):** PR A — plus a previously-missed correctness item,
`coerceContextType` (`coerce-raw-topology.ts`) defaulting unknown types incl.
`"driver"` to `"core"` and exporting a local 4-value `BoundedContextType` shadow
from agentic-interaction's public API — were folded into **PR #201**. A follow-up
review then caught **3 more copies #201 missed** (an `as` cast + two plain port
interfaces, which typecheck can't flag): `execute-staged-generation.use-case.ts`,
mcp-server `manifest-generation.port.ts`, and `manifest-io.ts` — fixed in
**PR #203**. The MCP surface and all coercion/port paths now derive from the
canonical `@hexagen/shared` set. **PR B and PR C remain.**

PR B is blocked on a product decision (below). PR C is a standalone refactor that
needs a usage audit first.

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

This is a DDD/product call. **Record it as an ADR** in `.architecture/decisions/`
(extending `ADR-0009-driver-context-wiring-strategy`, which already sanctions the
driver concept) rather than resolving it implicitly in the implementation. If `driver` is chosen **config-only**, add a follow-on: audit the
`@hexagen/project-configuration` validation and any `/projects/new` form UI so
`driver` isn't simultaneously "config-only" yet offered as a user-selectable
option. The rest of PR B is mechanical once the call is made.

---

## PR A — MCP tool params accept the full type set (· P2, low risk) — ✅ DONE in #201 (`d2bfda62`)

> Completed across **#201 + #203** (the latter caught 3 copies #201 missed — an
> `as` cast and two port interfaces typecheck couldn't flag). Scope grew beyond
> the original MCP tool-defs to the MCP **use-cases** (`create-context-tool`,
> `scaffold-module-tool`), the `ManifestWritePort` / `ManifestGenerationPort`
> types, `manifest-io.ts`, the staged-generation cast, and `coerceContextType`
> (`coerce-raw-topology.ts`, which silently mapped `"driver"`→`"core"`). All
> derive from `@hexagen/shared`; verified ripple-free via typecheck across the
> touched packages + web.
>
> **Follow-up not yet done:** add the non-optional regression test asserting each
> MCP tool's `enum` is _derived from_ `BOUNDED_CONTEXT_TYPES` (only the coerce
> path got a `driver` test). The original drift happened because the enum was
> hand-written, so a derivation test is the real guard. Original notes below.

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
- `convert-loose-spec.prompt.ts` — a TypeScript-interface snippet inside the
  prompt (`type?: "core" | … | "shared-kernel"`) teaching the LLM the shape; 4
  values (surfaced by a later review — the standard grep missed it).

**Fix.** Per the decision. **The primary deliverable is the `driver` definition
prose** — not the mechanical list sync. The classify prompt's `Definitions:`
block is prose, not a bare enum; if `driver` stays LLM-emittable it needs a
hand-written one-line entry describing what distinguishes a driver context —
interpolating the array just teaches the model a word with no meaning. Separately,
the bare _option lists_ can derive from `BOUNDED_CONTEXT_TYPES` (e.g.
`BOUNDED_CONTEXT_TYPES.join(", ")`) so they can't re-drift, but that only guards
the list; the definition prose stays hand-owned. Also fix the `compilePortsPrompt`
cast to `BoundedContextType`.

**Files.** `packages/agentic-interaction/src/domain/prompts/classify-context-type.prompt.ts`,
`generate-topology.prompt.ts`, `generate-manifest.prompt.ts`,
`convert-loose-spec.prompt.ts`.

**Tests.** Assert each `BOUNDED_CONTEXT_TYPES` value appears in the prompt's
_enumeration context_ (the options list / `Definitions:` block) — not merely
anywhere in the string, which a stray word or comment would satisfy. Update the
existing prompt-generation tests
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

1. **Usage audit — track import _paths_, not just symbol names.** The same symbol
   names exist in both packages, so a symbol-name grep gives false confidence;
   record which import path each consumer uses (`@hexagen/shared` vs
   `@hexagen/agentic-interaction` vs deep file paths). Note the main
   `@hexagen/shared` index does **not** re-export `domain/manifest/*`, so unifying
   there means hand-adding barrel exports (sync caveat) **and** updating every
   consumer that imports agentic-interaction's copy.
2. Then either:
   - **Unify** into `@hexagen/shared`, parameterizing the differences (max count;
     optional `contextMappings`/`apps`/mapping schema), and have
     agentic-interaction import them; **or**
   - **Delete the dead copy** if the audit shows one is unused; **or**
   - **Document the intentional divergence** (different draft shapes per stage)
     with a comment cross-linking the two, if both are genuinely needed as-is.

⚠️ **The `MAX_BOUNDED_CONTEXTS_DRAFT` divergence (10 vs 5) is the riskiest part**
— these caps gate LLM-output validation mid-pipeline and agentic's `5` may be
deliberate. If parameterized into a shared schema, **state who passes the value at
each call site**; a shared default of `10` would silently lift
agentic-interaction's cap from `5` (a silent regression). Confirm both values are
intentional before merging.

**Files.** the two `manifest-draft.schema.ts` files (+ importers found in the audit).

**Risk.** Med — these schemas validate LLM output mid-pipeline; subtle shape
differences (`.strict()`, extra fields, max) matter. Do not unify blindly.

**Acceptance.** One source for the draft schemas, or an explicit, documented
reason for two — and no third copy of the type field.

---

## PR D — Remaining bounded-context-type _type positions_ (· P2) — newly found

**Root cause.** A post-#203 sweep on the distinctive `"shared-kernel"` token (not
just the standard 4-tuple) found type-position copies the whole series missed —
and a second drift _variant_ that **drops `"generic"`** (a latent bug: a generic
context is unrepresentable there). All are plain interface fields / `as` casts,
so typecheck can't flag them.

| File                                                                  | Variant                                           | Note                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `manifest-generation/.../ports/in/client-manifest-generation.port.ts` | `core\|supporting\|driver\|shared-kernel`         | **missing `generic`** — `coerceContextType` port return type under-declares its own impl |
| `prompt-compiler/.../adapters/app-compatibility.adapter.ts`           | `core\|supporting\|shared-kernel\|driver`         | **missing `generic`** — `GovernancePayload.boundedContexts[].type`                       |
| `web-driver/.../domain/project.entity.ts`                             | `core\|supporting\|driver\|shared-kernel`         | **missing `generic`**                                                                    |
| `mcp-server/.../adapters/manifest-generation.adapter.ts`              | `core\|supporting\|generic\|shared-kernel` (`as`) | missing `driver` (same family as #203)                                                   |

**Fix.** Widen each to `BoundedContextType` from `@hexagen/shared` (all four
packages already depend on it). Type-only, decision-independent. The
`"generic"`-dropping copies are genuine latent bugs, so this is **P2, not
cosmetic**.

**Out of scope here — `@hexagen/sync`.** sync keeps its **own** manifest type
system (`sync/src/types/manifest/{manifest,bounded-context}.ts` +
`commands/arch/context/*` — several `core|supporting|driver|shared-kernel`
copies, also missing `generic`). sync is the standalone generator; whether it
should import the shared canonical or keep an independent contract is a separate
call — track it, don't fold it in.

**Risk.** Low–Med — widening interface fields is safe, but `web-driver`'s entity
and the manifest-generation port are more public; run typecheck across their
consumers (an `as` cast or exhaustive `switch` won't be auto-flagged).

**Acceptance.** No bounded-context-type literal union remains in a `src` type
position outside the canonical (verified by the `"shared-kernel"` sweep); the
`"generic"`-dropping copies are gone.

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
- **Sequencing.** PR A is **done (#201 + #203)** — and correctly landed before
  PR B, which matters: PR B's prompt changes could make classify emit `driver`,
  and the MCP handler had to accept it first. PR B is next (after the `driver`
  decision); PR C is a standalone refactor, after the audit.
- **Out of scope.** Test fixtures that cycle context types (e.g.
  `web-driver/__tests__/fixtures/load-testing.ts`) — they're sample data, not a
  validation surface. If any such fixture is used as _golden_ test input, it
  should eventually gain a `driver` entry so coverage spans the full type set.
