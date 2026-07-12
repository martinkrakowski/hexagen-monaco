# Import Hardening & Review-Summary UX — Findings and Remediation Plan

**Date:** 2026-07-11
**Trigger:** Production import failure (alvaro-ai manifest, 9 contexts): the full
staged pipeline succeeded — Stage-6 review, Stage-7 repair attempt, advisory
findings — then the accept screen's **Next** click failed with the fixed string
_"The generated manifest could not be parsed. Go back and try again."_ No prod
log, no diagnosable trace, ~4 minutes of generation lost. Import errors of this
class have been a **recurring pattern across projects**. Requirement: the import
path must be highly intelligent and mostly autonomous in sanitization and
processing — enterprise-grade, no user-visible errors across structured and
unstructured input types.

---

## 1. Root cause (fixed in PR #407)

`apps`, `context_mappings`, and domain-layer names are **LLM-derived** (the
loose-spec conversion output is only shape-checked; Stage-7 repair ops can write
these slots too) and flowed **verbatim** into the rendered YAML. The accept
screen parses that YAML with the **strict** `ManifestSchema`
(`parseManifestToWizardData`). A single app entry without a `name`, a mapping
missing an endpoint, or a nameless aggregate (rendered as `- null` under
`entities`) failed the whole parse. Nothing server-side ever checked that the
pipeline's own output parses; the client banner swallowed the Zod detail
(dev-gated log only).

**Shipped in #407 (branch `fix/manifest-schema-gate`):**

1. **Stage-5 schema gate** — `packages/agentic-interaction/src/domain/manifest/enforce-manifest-schema.ts`,
   called inside `ExecuteManifestAssemblyUseCase` (the single seam shared by the
   spec path, the prompt path, and the Stage-7 reassembly). Sanitizes before
   rendering (coerce bare-string apps, drop nameless apps / endpoint-less
   mappings / non-string domain+port entries), then verifies with the same
   `ManifestSchema` the accept screen uses. Every change surfaces as a
   `Stage 5 ·` adjustment chunk + report warning; residual issues (should be
   unreachable) merge into the validation report as errors.
   **Invariant: a manifest the pipeline returns always parses on accept.**
2. **Ingestion filters** — `normalizeDialect` filters/coerces `apps`,
   `context_mappings`, and canonical `aggregates`/`value_objects`/
   `events_published` at parse time, before the SPEC_REVIEW screen.
3. **Actionable client error** — parser errors carry field paths
   (`apps.0.name: Required`); `ImportProjectSpecPage` quotes the real cause and
   logs in prod.

---

## 2. Corpus evidence — current state of the ingestion seam

Measured against the built code (`parseStructuredConfig`, post-#407):

| Input type                                                                              | Deterministic path? | Notes                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical YAML/JSON (`bounded_contexts:`)                                               | ✅                  | clean                                                                                                                                                                            |
| Multi-doc YAML (`---` separators)                                                       | ✅                  | merged, conflict-safe                                                                                                                                                            |
| Rich hexagonal dialect (`domain_models`, `primary_use_cases`, `ports.{primary,driven}`) | ✅                  | mapped by `normalizeDialect`                                                                                                                                                     |
| LLM-garbage `apps`/`context_mappings`                                                   | ✅                  | sanitized + reported (#407)                                                                                                                                                      |
| **Hexagen manifest dialect (`contexts:` + top-level `ports:`/`adapters:`/`planes:`)**   | ❌                  | fails shape check → routed to mercury-2 loose conversion: nondeterministic, slow, **lossy** (alvaro's planes, model registry, branding, defaults, dependencyRules all discarded) |
| Pseudo-YAML w/ TS signatures (`signature: (order: Order) => Promise<void>`)             | ❌                  | `sanitizePseudoYaml` recovery misses this shape → LLM detour                                                                                                                     |
| Markdown / prose / unstructured                                                         | LLM by design       | output now guaranteed parseable, quality = model-dependent                                                                                                                       |
| Empty / binary garbage                                                                  | rejected at seam    | UI routes to description mode                                                                                                                                                    |

---

## 3. Remaining gaps

- **G1 — `contexts:` dialect takes the LLM detour.** The most structured,
  highest-intent files (real Hexagen manifests) get the least deterministic
  treatment. `detectInputMode` (apps/web) only recognizes `bounded_contexts:`.
- **G2 — no import regression harness.** The structural reason the pattern
  _recurs_: nothing in CI feeds representative import files through the
  pipeline and asserts the result parses and preserves the input's content.
  (Same disease as the Vellum findings' generate-then-gate headline.)
- **G3 — conversion truncation exposure.** Loose-spec conversion caps input at
  200k chars and output at 8,000 tokens. A ~25+-context spec blows the output
  ceiling; `jsonrepair` salvages a truncated JSON and can silently drop tail
  contexts. Nothing detects or reports this.
- **G4 — nameless context crashes the pipeline** (`ctx.name.toLowerCase()` →
  500 mid-run). Visible but ugly; should be drop-with-advisory.
- **G5 — pseudo-YAML sanitizer holes** (TS-signature scalars), pushing
  well-structured specs onto the lossy LLM path unnecessarily.
- **G6 — UX: every completed run reads like a failure.** See §4.

---

## 4. UX workstream — success-first review summary

**Problem (reported by Martin):** the generation log always appears as if the
manifest was generated _with errors_; users are never told the manifest is
correct and they can move forward.

**Findings** (`apps/web/features/manifest-generation/import-project-spec/ManifestGeneratingStep.tsx`):

- **No success state exists.** On `phase === "complete"` with a clean report,
  the component renders _nothing_ — no "ready to continue" signal; the header
  stays "Generating Manifest".
- With any advisory finding, the panel is warning-tinted and headlined
  _"Manifest generated — the review found N issues and M warnings **to
  address**"_ — error-first framing for findings that are explicitly advisory
  (the manifest is produced and usable; Stage-6 findings never block).
- The Stage-7 line _"attempted a repair but couldn't reduce the errors"_ reads
  as a failure even though the original manifest is fine to use.
- **#407 interaction:** the new schema-gate advisories (`Coerced app entry …`,
  `Dropped …`) are NOT matched by `isAutoAppliedNotice` (anchored on the
  R01/R03/R12 copy), so they'd display as actionable review warnings —
  worsening the false-error impression.

**Fix:**

1. Always render a completion banner on `complete`: success-toned,
   _"Manifest generated successfully — ready to review. Continue with Next."_
   Update the step header when complete.
2. Reframe findings as secondary: _"The review also noted N advisory
   findings — optional improvements; the manifest is valid to use as-is."_
   Findings list collapsed by default (`<details>`), neutral styling; reserve
   destructive styling for `generationError` / genuine blockers only.
3. Reword the failed-repair line: honest but calm ("the original manifest was
   kept; the findings remain advisory").
4. Classify #407 gate advisories as auto-applied notices (extend
   `AUTO_APPLIED_ADVISORIES`; longer-term: a structured `notices` field on the
   validation report instead of string prefix matching — already flagged in the
   code comment).

---

## 5. Workstreams P1–P4 (import hardening)

### P1 — Deterministic `contexts:` dialect importer (G1, G5)

Map the Hexagen manifest dialect onto `StructuredConfig` in
`normalizeDialect`/`parseStructuredConfigStrict` so it never reaches the LLM:

- `contexts:` (array of named objects) → `bounded_contexts:` when
  `bounded_contexts` is absent; `name:`/`displayName:` → `project`.
- Top-level `ports:` assigned to their owning context **by `path` prefix
  match** against each context's `path:` (e.g.
  `packages/core/image-domain/src/ports/…` → context with
  `path: packages/core/image-domain`); default direction `out` (driven
  interfaces), inbound only on inbound naming (`inferInboundPortType`).
- Top-level `adapters:` (`{name, implements, context}`) → the named context's
  `layers.infrastructure.adapters`; `implements` re-inferred downstream by
  `inferAdapterImplements` (#400).
- `plane: SharedKernel` casing: normalize `sharedkernel` (no hyphen) onto the
  existing shared-kernel type mapping; accept the array-of-objects `planes:`
  block form.
- `detectInputMode` (apps/web) recognizes a non-empty `contexts:` array of
  named objects as `structured-config`.
- P4 folded in: widen `sanitizePseudoYaml` to quote TS-signature scalars.

**Acceptance:** the alvaro manifest imports with zero LLM conversion, preserving
all 9 contexts, 3 ports (correct owners), 5 adapters; existing dialects
unaffected.

### P2 — Import corpus harness in CI (G2)

Fixture corpus in `packages/agentic-interaction/__tests__/e2e/import-corpus/`
(one file per supported type from §2 + adversarial cases), driven through:
parse → normalize → classification → pre-defined port map → Stage-5 assembly
(fake LLM port for stages that would call out). Assert per fixture:

1. Deterministic routing (which fixtures may NOT require the LLM).
2. Assembled manifest passes `parseManifestToWizardData`.
3. Content preservation: context/port/adapter counts vs a golden expectation
   file (update-snapshot workflow like the existing golden harness).

### P3 — Crash-proofing + truncation detection (G3, G4)

- Drop bounded_contexts entries without a usable string `name` at ingestion
  (before anything dereferences `.name`); shape-error only if none survive.
- Loose-spec conversion: detect output-ceiling truncation (response length
  near `maxTokens`, or jsonrepair had to close unbalanced structures at the
  tail) → surface a loud chunk/warning ("conversion may be incomplete — N
  contexts converted") instead of silently proceeding.

### P4 — `sanitizePseudoYaml` widening (G5) — folded into P1.

---

## 6. PR mapping & sequencing

| PR   | Scope                                                             | Status |
| ---- | ----------------------------------------------------------------- | ------ |
| #407 | Schema gate + ingestion filters + actionable errors               | OPEN   |
| #408 | UX: success-first review summary (§4)                             | OPEN   |
| #409 | P1 + P4: deterministic `contexts:` dialect import                 | OPEN   |
| #410 | P2 + P3: import corpus harness + crash-proofing (stacked on #409) | OPEN   |

`Status` reflects GitHub PR state. Sequencing: UX first (small, user-visible),
then P1 (+P4), then P2 (+P3, so the harness locks in P1's behavior). #407 and
#408 are independent branches off `main`; #409 branches off `main`; #410 is
**stacked on #409** (its corpus asserts the manifest-dialect fixture #409 adds),
so retarget #410 to `main` before #409 squash-merges.

**Definition of done for the arc:** a user can import any file in §2's corpus —
including real Hexagen manifests and messy unstructured prose — and either get
a deterministic, content-preserving import or an autonomous LLM conversion
whose output is guaranteed accept-parseable, with a completion screen that
plainly says the manifest is ready, advisory findings clearly optional, and
every automatic adjustment reported.
