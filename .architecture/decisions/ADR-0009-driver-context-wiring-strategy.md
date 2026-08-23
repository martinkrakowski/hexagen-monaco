# ADR-0009: Driver-Context Wiring Strategy

**Date:** 2026-04-05
**Status:** Accepted — partially superseded by ADR-0057 (2026-08-23): the attribution of `MonacoPersistencePort` to `monaco-orchestration`
**Type:** Architecture

## Context

During code review, a potential bidirectional dependency smell was identified between `web-driver` and bounded contexts (`monaco-orchestration`, `visualization`):

1. `MonacoPersistencePort` is owned by `monaco-orchestration` but implemented by `web-driver` (LocalStoragePersistenceAdapter)
2. `ArchitectureGraphProviderPort` is owned by `visualization` but implemented by `web-driver` (ArchitectureGraphProviderAdapter)

This creates a pattern where the driver (frontend app) implements ports owned by core/supporting contexts.

## Decision

**Accept the current wiring strategy** with documented rationale. This is NOT a violation but an intentional pattern for this architecture.

### Rationale

1. **Port ownership remains single**: Each port is declared in exactly one bounded context (`monaco-orchestration`, `visualization`). The adapter lives in `web-driver` but the port contract remains in the owning context.

2. **Dependency direction is correct**: `web-driver` → `monaco-orchestration` (imports the port interface, not vice versa)

3. **Driver role**: Drivers are the "outer ring" in hexagonal architecture. Their job is to implement ports for external systems (browser, localStorage, Monaco editor). Having adapters in the driver is correct.

4. **Testability**: This pattern allows testing core business logic without the frontend - ports are defined in core/supporting contexts, adapters are in driver.

### Risks

- If a core context later needs to consume a port owned by the driver, that would create a cycle. This is prevented by rule: "Drivers should only implement ports; never also own them."

## Consequences

### Positive

- Clear port ownership (in owning context)
- Flexible adapter implementation (in driver)
- Easy to swap adapters (e.g., different storage mechanisms)

### Negative

- Requires discipline to not let core contexts depend on driver
- Adapter code lives in `apps/web` package, not in a reusable package

## References

- `AGENTS.md` section on wiring strategies
- `.architecture/manifest.yaml` bounded context declarations
