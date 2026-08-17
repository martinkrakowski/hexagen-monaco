# @hexagen/ui

Projection layer - UI primitives, controllers, and design tokens.

This package provides the foundation for the HexaGen Monaco UI layer, implementing the 3-layer information state firewall that strictly isolates the projection system from the deterministic kernel.

## Architecture

This package is part of the **Projection Plane** in the three-plane topology:

- **Kernel Plane**: Semantic truth, rule resolution (@hexagen/core-domain)
- **Projection Plane**: UI rendering, layout solving (@hexagen/ui)
- **Probabilistic Plane**: LLM outputs, observations (@hexagen/local-llm, @hexagen/agentic-interaction)

## Packages Structure

```
@hexagen/ui
├── tokens/       # Design tokens (HSL-based, theme-aware)
├── controllers/ # Headless behavior hooks (Aria/Radix-based + custom)
├── elements/    # Stateless primitives (Button, Input, Card, etc.)
├── modules/     # Interaction composites (ViewToggle, Tabs, etc.)
└── sections/    # Layout shells (Dialog, ResizableShell, AppShell)
```

## Information State Firewall

This package enforces a strict firewall against information-state pollution:

1. **Layer 1 (TypeScript)**: Branded types prevent information-state values from entering UI props
2. **Layer 2 (ESLint)**: Custom rules forbid forbidden tokens (`loading`, `data`, `error`, etc.)
3. **Layer 3 (CI)**: Dependency graph analysis catches bypass attempts

## Forbidden Imports

This package MUST NOT import from:

- `@hexagen/core-domain` (kernel types)
- `@hexagen/local-llm`
- `@hexagen/agentic-interaction`
- Feature slices (`apps/web/features/*`)

This package MAY import from:

- `@hexagen/shared`
- `@hexagen/ui/*`
- React
- @react-aria/\* (Aria hooks)
- Radix primitives

## Versioning

This package follows semantic versioning aligned with the MVK contract version.
