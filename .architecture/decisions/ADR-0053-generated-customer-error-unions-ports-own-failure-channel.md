# ADR-0053: Generated Customer Error Unions: Ports Own Their Failure Channel, Never Import infrastructure/

**Date:** 2026-08-14
**Status:** Proposed
**Type:** Architecture
**Relates to:** remediation-plan items 0.7 (this ADR) and 5.9 (implementation); findings HEX-001, HEX-036; ADR-0007 (barrel-generation consolidation) and ADR-0043 (linter derives cross-context import legality from manifest `depends_on`)

## Context

Hexagen-Monaco ships hand-authored **project templates** under
`packages/template-engine/templates/*`. Each template's `files/` tree is the
literal source a generated customer project inherits, so any layering choice
baked into a template becomes a layering choice in every project scaffolded
from it. Two of those choices currently invert the hexagonal dependency rule at
the point where a port declares its failure channel.

**HEX-001 — outbound ports import their error type out of `infrastructure/`.**
Fourteen outbound port files under `src/domain/ports/out/*.port.ts` import their
error union from a sibling `infrastructure/` path with a type-only import:

- 13 Adobe templates import `FireflyError`, e.g.
  `packages/template-engine/templates/adobe-firefly-generate/files/src/domain/ports/out/image-generation.port.ts:4`
  (`import type { FireflyError } from "../../../infrastructure/adobe/errors/firefly-errors";`),
  used on the port's method signatures at lines 52–60
  (`Promise<Result<string[], FireflyError>>` on
  `textToImage`/`generativeFill`/`generativeExpand`/`imageToImage`/`styleTransfer`).
  The other 12 are the outbound ports in `adobe-firefly-content-tagging`,
  `adobe-illustrator`, `adobe-firefly-custom-models`, `adobe-creative-production`,
  `adobe-firefly-composite`, `adobe-indesign`, `adobe-firefly-media`,
  `adobe-lightroom`, `adobe-photoshop`, `adobe-firefly-upscale`,
  `adobe-express`, and `adobe-substance-3d`.
- 1 LLM template imports `LLMError`:
  `packages/template-engine/templates/llm-adapter/files/src/domain/ports/out/llm-client.port.ts:3`
  (`import type { LLMError } from "../../../infrastructure/llm/errors/llm-errors";`),
  used on `call`/`callStructured` (lines 25–36).

The template even self-justifies the inversion in a code comment. The comment
is _not_ the phrase the source candidate quoted ("deliberate decoupling"); the
actual current-tree comment reads:

> `// Type-only import of the infrastructure error (erased at compile) — types a`
> `// port's failure channel without runtime domain→infra coupling.`
> (`adobe-firefly-generate/.../image-generation.port.ts:2-3`)

The reasoning in that comment is the bug. A `type`-only import is erased from
the JavaScript emit, but it does **not** invert the _compile-time_ dependency
direction: `src/domain/` still names a symbol owned by `src/infrastructure/`, so
the port is not implementable, testable, or type-checkable without the
infrastructure module present. The error type it depends on is a concrete
`class FireflyError extends Error` living entirely in infrastructure
(`adobe-firefly-core/.../infrastructure/adobe/errors/firefly-errors.ts:10`,
tagged `// @hexagen-server-only` at line 1). Hexagonal layering (ADR-0007 and
the layer convention the arch-linter enforces) is `domain → (nothing outward)`;
a domain port depending on an infrastructure class is exactly the direction the
ports & adapters pattern exists to forbid.

**HEX-036 — a driven port declared _inside_ `infrastructure/`.** The same
pattern is inverted the other way in the AgentCore template: the driving-side
contract the runtime depends on, `AgentRuntimePort`, is declared at
`packages/template-engine/templates/bedrock-agentcore-runtime/files/src/infrastructure/agentcore/runtime/payload.ts:60`.
Its own docstring (payload.ts:42-48) describes it as the port the inbound HTTP
adapter depends on and nothing else: _"the inbound HTTP adapter depends only on
this port, never on a concrete agent."_ That is an application/domain contract
by definition, yet it physically lives in the infrastructure layer — the
mirror image of HEX-001 (there, domain reaches into infra; here, the port is
authored in infra to begin with).

**Why the fence does not catch either case.** The host arch-linter's domain
rule short-circuits any relative intra-package import: at
`tools/arch-linter/src/index.ts:351-357` a domain file's import that
`startsWith(".")` (or `/`) is treated as _"Relative import within same package -
allowed"_ and skipped before the allowed-layers check. Because the offending
imports are all relative (`../../../infrastructure/...`), the linter reports
these ports as compliant — both in the host repo and, more importantly, in
every generated project, which inherits the same linter with the same hole
(AUD-011). Fixing the templates without a governing decision would leave the
fence blind to any regression; that fence repair is Wave-2 item 2.2, and the
decision it enforces for these ports is this ADR.

This ADR is a Wave-0 decision only. The template + bundle edits are executed in
Wave-5 item 5.9, gated on this ADR's acceptance.

## Decision

Adopt **domain-owned error unions, mapped at the adapter** (candidate C8
option 1). Concretely:

1. **A port's failure type is owned by the layer that declares the port.**
   Outbound ports under `src/domain/ports/out/*.port.ts` reference an error
   union that lives in `src/domain/` (a customer-domain type such as a
   `CreativeProductionError` / provider-neutral `LLMError` union), never a type
   imported from `src/infrastructure/`. The concrete, server-only error classes
   (`FireflyError` and its subclasses in `infrastructure/adobe/errors/`, the
   `llm-adapter` error classes in `infrastructure/llm/errors/`) **stay in
   infrastructure** and are **mapped to the domain union at the adapter
   boundary** — the adapter catches the concrete infra error and converts it to
   the domain error union when it fulfills the `Result<T, E>` contract. This is
   the direction the existing `firefly-errors.ts` docstring already describes
   for throwing/catching ("service adapters catch and convert to
   `Result<T, FireflyError>`", firefly-errors.ts:6-8); the change is that the
   union named on the port becomes a domain type, not the infra class.

2. **`AgentRuntimePort` moves to an application/domain layer.** The
   `AgentRuntimePort` contract (and its `AgentRunInput` / `AgentRunResult`
   companions) is emitted under `src/domain/` (or the template's application
   layer), not `src/infrastructure/agentcore/runtime/payload.ts`. The inbound
   HTTP adapter and the placeholder agent import it from there. The Zod
   request/response envelope schemas in `payload.ts` (the HTTP wire contract)
   are legitimately infrastructure and stay put; only the driven port relocates.

3. **Ports never import `infrastructure/`.** As a standing rule for generated
   templates and the host: no file under `src/domain/` (ports included) may
   import from a sibling `infrastructure/` path, type-only or otherwise. The
   type-only-is-safe rationale is rejected — it does not invert the compile-time
   dependency. This is the port-facing half of the layer rule the Wave-2 linter
   fix (item 2.2) makes enforceable by closing the relative-import hole at
   `tools/arch-linter/src/index.ts:351-357`.

4. **The generated bundle is regenerated together with the templates.** Because
   the wizard's template-question surface is a generated artifact
   (`apps/web/features/project-wizard/steps/template-questions-step/template-questions.generated.ts`,
   produced by `apps/web/package.json` script `gen:template-questions`, verified
   by `check:template-questions` in CI), any template edit that changes emitted
   files must be followed by a bundle regeneration in the same change so the
   generated output and its check stay in sync.

Options **2** (keep infra errors, document a generator exception) and **3**
(shared `Result` error codes in the customer `shared/` kernel) are rejected:
option 2 is the status quo the layer rule forbids, and option 3 moves the type
to the wrong owner (a shared kernel) rather than the domain that owns the port.

## Consequences

- **Wave-5 item 5.9 inherits a bounded, enumerable edit.** Fourteen port files
  change their error-type import from an `infrastructure/` path to a domain
  union (13 Adobe `FireflyError` importers + 1 `llm-adapter` `LLMError`
  importer), each paired with an adapter-side mapping so the concrete infra
  error is converted at the boundary; plus the `AgentRuntimePort` relocation in
  the AgentCore template; plus one `gen:template-questions` bundle regen. The
  count is recomputed from the tree
  (`rg -l "from ['\"](\.\./)+infrastructure/adobe" --glob '**/domain/ports/out/*.port.ts'`
  → 13; the same over `infrastructure/llm` → 1), not copied from the candidate.
- **Every project generated after 5.9 is layering-clean by construction** — its
  domain ports own their failure channel, and its inherited arch-linter (once
  the Wave-2 hole is closed) fails CI on any reintroduction of a
  domain→infrastructure port import. Projects generated before 5.9 keep the old
  pattern until re-scaffolded; this ADR governs the templates, not existing
  customer checkouts.
- **The self-justifying comment is removed, not preserved.** The template
  comment that rationalizes the type-only infra import
  (`image-generation.port.ts:2-3` and its 12 siblings) is deleted with the fix;
  leaving it would re-teach the anti-pattern to anyone reading the generated
  code.
- **Adapter code gains an explicit mapping step** it did not have when the port
  named the infra class directly — this is the intended cost: the mapping is
  the seam that keeps the concrete `@hexagen-server-only` error classes out of
  the domain and out of any client bundle.
- **First-Run-Green must be re-verified.** Because the edit touches every Adobe
  and LLM template's port surface, 5.9's acceptance runs the capstone
  generated-project harness (typecheck + build + the arch-lint that Wave 2 made
  real) so the relocation does not break a scaffolded project's compile.

## Fact-check note (verification of the candidate)

The candidate's structural claim is confirmed against the current tree: ports
under `src/domain/ports/out/` do import their error type from `infrastructure/`
(14 files — 13 Adobe `FireflyError` + 1 `llm-adapter` `LLMError`, counts
recomputed from the tree), and `AgentRuntimePort` is declared inside
`src/infrastructure/` (`payload.ts:60`). One correction: the candidate quotes the
template comment as calling the import "deliberate decoupling"; the actual
comment in the tree is "types a port's failure channel without runtime
domain→infra coupling" (`image-generation.port.ts:2-3`). The substance the
candidate targets — a comment that rationalizes the domain→infra import as
acceptable — is present and still the bug; only the exact wording differs.
