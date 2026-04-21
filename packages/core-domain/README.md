# @hexagen/core-domain

Deterministic semantic kernel - MVK contracts and rule execution manifests.

This package contains the compiled contract intermediate representation (MVK) that serves as the canonical semantic boundary between the deterministic kernel, projection system, and probabilistic layer in HexaGen Monaco.

## MVK v1

The MVK v1 contract surface includes:

- Domain Abstract Syntax Tree (DomainAST)
- NodeKind and EdgeKind taxonomies
- DomainCommand discriminated union
- ResolvedRuleProgram (RRP) and RuleExecutionManifest (REM) shapes
- NodeVisualSpec stub (projection boundary)
- IntentLineage tracking
- Topological and cardinality invariants

All types are strictly exported from this package. No runtime logic is included - this is a contracts-only package.

## Versioning

This package follows semantic versioning aligned with the MVK contract version:

- MVK v1 → @hexagen/core-domain@0.1.x
- MVK v2 → @hexagen/core-domain@0.2.x (when released)

See `.architecture/mvk/spec-v1.md` for the detailed MVK v1 specification.
