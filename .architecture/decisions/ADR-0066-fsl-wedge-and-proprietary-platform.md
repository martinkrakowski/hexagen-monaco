# ADR 0066: FSL Wedge and Proprietary Platform

## Status

Accepted

## Context

We are refining the licensing and business model for Hexagen-Monaco. We need to decide how to structure the licensing to support bottom-up adoption while maintaining a sustainable commercial model (Decisions D-3 and D-1). We need a "Business Answer" that balances open adoption with proprietary value.

## Decision

We will adopt the "Business Answer" (FSL Wedge for bottom-up adoption).

1. **Wedge (FSL-1.1-Apache-2.0):** We will extract the drift-check surface into `tools/arch-linter`. This package will be licensed under the Functional Source License (FSL-1.1-Apache-2.0). This allows internal and commercial internal use while preventing competing products from building on the core architectural validation engine.
2. **Platform (Proprietary):** The `packages/sync` generator and the broader platform (web app, staged generation, hosted history, agent-constraint pack) will remain proprietary under the Source-Available Evaluation License.

## Consequences

- The linter (`tools/arch-linter`) can be widely adopted and integrated into any CI/CD pipeline, establishing Hexagen-Monaco's architectural enforcement as a standard.
- The generative capabilities (`packages/sync`) and visual/agentic governance platform remain proprietary, preserving commercial value and ensuring a clear upgrade path for enterprises needing more than just the baseline validation.
- Existing users of the sync generator are reassured that their scaffolds remain intact and supported, though the generator tool itself remains under the proprietary evaluation license for commercial production use.
