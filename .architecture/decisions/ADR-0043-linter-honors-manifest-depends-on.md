# ADR-0043: Linter Derives Cross-Context Import Legality from Manifest `depends_on`

**Date:** 2026-06-12
**Status:** Accepted
**Type:** Architecture
**Resolves:** sync-toolchain plan decision D2 / RCA #8
**Extends:** ADR-0009 (linter bundles the manifest loader)

## Context

The manifest's own documentation — and the linter's success message
("Architecture is compliant with manifest.yaml") — claim that `arch validate`
checks code against `manifest.yaml`. In practice, cross-context import
legality was decided **exclusively** by `.architecture/invariants/`
(`linter-config.yaml` `global_whitelist` + `package_rules`); the per-context
`depends_on` declarations the wizard records into the manifest were never
read. Empirically verified in campaign-foundry (RCA #8): adding a context to
three contexts' `depends_on` changed nothing in `arch validate` output.

That split means a scaffolded project's declared architecture (manifest) and
its enforced architecture (invariants files) are two different documents, and
the one the tooling tells users to maintain is the one that does nothing.

The remediation plan flagged this as decision **D2** with two options:

- **(a)** the linter derives allowed cross-context imports from manifest
  `depends_on` — per-context precision, manifest as the single source of
  truth, invariants files as additional constraints;
- **(b)** docs-honesty only — messages stop claiming the manifest governs
  imports, and the wizard generates the invariants whitelist _from_
  `depends_on` at scaffold time.

## Decision

**Option (a).** For a context `X` importing `@scope/pkg`, the import is legal
iff it survives this ladder (highest precedence first):

1. **Not cross-context** — non-scope specifiers and same-package imports are
   never violations (unchanged).
2. **`global_whitelist`** (linter-config; defaults to `@scope/shared`) —
   grant (unchanged, including its historical precedence over
   `cannot_import`).
3. **`cannot_import`** (linter-config `package_rules`) — explicit per-edge
   **denial**. This is how invariants remain _additional constraints_: a
   config denial beats a manifest grant.
4. **Shared-kernel contexts** — a context declared `type: shared-kernel` in
   the manifest is importable from every context (new; manifest-derived).
5. **`X.depends_on` contains `pkg`** — the manifest edge grants the import
   (new; the heart of this ADR).
6. **`allowed_imports`** (linter-config `package_rules`) — config grants
   beyond the manifest remain valid (unchanged).
7. **`restricted_to`** (linter-config `package_rules`) — closed allow-list
   for imports not granted above (unchanged position).
8. Otherwise — violation.

`depends_on` and `restricted_to` express the same concept (a per-context
allow-list) in two places; under this ADR the **union** governs — a grant in
either suffices. The only way to forbid a manifest-declared edge is the
explicit `cannot_import` denial. The alternative (intersection — requiring
both documents to agree) would resurrect exactly the RCA #8 complaint:
declaring a dependency in the manifest would still change nothing until the
invariants file is edited too.

The success messages stop overclaiming: the linter (and the `arch validate` /
sync wrappers that relay it) now name what was actually checked instead of
the blanket "compliant with manifest.yaml".

Option (b) remains the documented fallback if (a) reveals consumer breakage —
the change is strictly _loosening_ (it only converts violations into passes),
so breakage would mean a consumer relied on the linter rejecting an edge its
own manifest declares.

## Frozen-context clearance

The linter conceptually belongs to the `architectural-enforcement` context,
which carries `status: frozen` (since 2026-05-12). That freeze applies to the
context's **package namespace** (`packages/architectural-enforcement` —
empty; its own description points at the live homes: "ESLint plugin lives in
@hexagen/eslint-plugin-ui. Boundary validation in tools/arch-linter"). The
linter tool itself has been actively maintained post-freeze — #241 added
`required-communication-violation.ts` on 2026-06-06 under the same reading.
This ADR records that reading explicitly: changes to `tools/arch-linter` do
not violate the context freeze; the freeze guards against resurrecting the
package, not against maintaining the tool.

## Consequences

- A scaffolded project's `depends_on` is now operative: declaring an edge in
  the manifest legalizes the import with no `linter-config.yaml` edit. The
  scaffold's generated `global_whitelist` (shared kernel only) no longer
  makes every cross-context import a violation by default.
- Existing projects only get _fewer_ violations, never more: every grant
  source that existed before this ADR still grants.
- The linter reads `bounded_contexts[].type === "shared-kernel"` and
  `bounded_contexts[].depends_on` — both long-standing manifest schema
  fields; no schema change.
- campaign-foundry follow-up: its `global_whitelist` workaround entries can
  migrate to `depends_on` declarations at leisure (both keep working).
- The cross-package decision moves from closures inside the linter's
  `index.ts` into `tools/arch-linter/src/cross-package-violation.ts`
  (dependency-free, unit-tested), following the established
  `subpath-violation.ts` / `required-communication-violation.ts` pattern.
