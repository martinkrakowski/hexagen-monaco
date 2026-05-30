# Architecture

Style: **{architecture_style}**

> {project_description}

## Universal Boundary Rules

These hold regardless of style and are enforced in review:

- **Dependencies point inward / downward.** Business logic never imports
  framework, transport, or persistence code. The edges depend on the core, not
  the other way round.
- **No circular dependencies** between modules.
- **I/O lives at the edges.** Network, filesystem, database, and clock access
  are isolated behind a thin boundary so the core stays pure and testable.
- **One reason to change per module.** If a file mixes business rules with
  wiring, split it.

## Layer Conventions

The naming below is the convention for the **{architecture_style}** style. If
your style differs, keep the *intent* (clear boundaries, inward dependencies)
even if the folder names change.

- **hexagonal** — `domain/` (entities, value objects, pure logic), `application/`
  (use cases + `*.port.ts` interfaces), `infrastructure/` (`*.adapter.ts`
  implementations). Domain imports nothing outward; adapters implement ports.
- **layered** — `presentation/` → `application/` → `domain/` → `infrastructure/`,
  each layer importing only the one below it.
- **feature-based** — top-level `features/<name>/` slices, each self-contained;
  shared code lives in a `shared/` module that features may import but that
  never imports a feature.
- **monolith** — keep modules cohesive and dependencies explicit; resist a
  single god-module by grouping by responsibility.

## Adding Code

1. Identify the layer the change belongs to.
2. If it crosses a boundary, define/extend a port (interface) rather than
   reaching across directly.
3. Put the test next to the module (see `.agents/testing.md`).
