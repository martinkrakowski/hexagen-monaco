# ADR-0058: Deleting an Active Implemented Context With Zero Live Consumers

**Date:** 2026-08-17
**Status:** Accepted — partially supersedes ADR-0018 (Q1/Q7 `intent-compiler` naming)
**Type:** Architecture
**Relates to:** ADR-0049 (unregistered + scaffold-grade deletion), ADR-0050 (frozen AND no-runtime-code deletion), ADR-0018 (MVK kernel membership — Q1 / Q7 naming of `intent-compiler` is superseded here), HEX-032 / plan row 8.12(e)

> Numbering note: the highest pre-existing record was ADR-0057; this ADR takes the next contiguous slot.

## Context

`@hexagen/intent-compiler` was a registered, `status: active`, fully implemented hexagonal package: gesture parsing, topology checks (acyclic / containment / degree / connected), cardinality checks (Exactly / AtLeast / AtMost / Between), rejection emission, and a substantial adapter test suite.

Plan row 8.12(e) / HEX-032 asked to relocate those topology and cardinality invariants out of the infrastructure adapter. A consumer audit run on 2026-08-17 found **zero live `import` consumers** of `@hexagen/intent-compiler` across `packages/`, `apps/`, and `tools/`. `@hexagen/runtime` re-exports type guards (`isAcyclicInvariant`, `isExactlyInvariant`, …) over `@hexagen/core-domain` IR types; it does not implement the checks the deleted package owned.

Two existing deletion predicates do **not** cover this case:

- **ADR-0050** deletes only "frozen AND no runtime code". `intent-compiler` was `status: active` and had runtime code. Its `FROZEN.md` recorded an unfreeze in Phase 2a. ADR-0050 also **explicitly retains** `transaction-system`, which is frozen, implemented, and likewise unconsumed.
- **ADR-0049** deletes "unregistered, zero consumers, scaffold-grade implementation". `intent-compiler` was registered and implemented, not a scaffold.

Without a third predicate, deleting the package would be a one-off that contradicts both records. Relocating unused invariants into `runtime` / `core-domain` would have moved dead code into live, manifest-visible contexts — the same liability ADR-0049's 2026-08-16 amendment refused when it deleted `security`'s unused value objects instead of migrating them.

## Decision

**An active, implemented, registered bounded context with zero live consumers, and that no other ADR retains, may be deleted outright.** HEX-032 is closed by that deletion, not by relocating the invariants.

The consumer audit must be of **live imports and graph declarations**, not comments, historical ADRs, or plan rows. Graph declarations that must be removed in the same change include:

- the `packages/` directory and its workspace membership (the `packages/*` glob drops it automatically)
- `.architecture/manifest.yaml` `bounded_contexts` entry
- `.architecture/contexts/**/<name>/context.yaml`
- `tsconfig.base.json` `references` (HEX-035)
- `package_rules` / import grants in `linter-config.yaml` and `workspace.config.yaml`
- kernel-firewall entries (`scripts/firewall-blocklist.yaml` and the matching `packages/ui` `no-restricted-imports` group)
- `yarn.lock` workspace binding (via `yarn install`, never a hand edit)

**This predicate does not apply to `transaction-system`.** ADR-0050 Decision 2 retains that package as frozen-but-implemented. A later deletion of `transaction-system` requires amending ADR-0050; this ADR is not that amendment.

**This predicate does not apply to frozen no-code scaffolds** (still ADR-0050) **or unregistered scaffolds** (still ADR-0049).

## Consequences

- `@hexagen/intent-compiler` is removed from the monorepo, the manifest, the project-reference graph, the firewall, and the lockfile.
- Topology and cardinality _checking_ is no longer implemented in-repo. The IR types and `runtime` type guards remain. Reintroducing the checks is a new package (or a new home under a live consumer), not a restore of the deleted hexagon.
- ADR-0018 Q1's "intent is compiled by the deterministic kernel (intent-compiler)" and Q7's kernel-plane membership list no longer name a living package. The hybrid-controller _model_ in Q1 is unchanged; only the named compiler is gone. See the 2026-08-17 amendment on ADR-0018.
- Plan row 8.12(e) / HEX-032 is done. A future sweep must not treat "unconsumed" as sufficient on its own — the retaining-ADR carve-out is load-bearing.
- Historical planning snapshots and ADRs that mention the package stay as written; they are records, not inventories.
