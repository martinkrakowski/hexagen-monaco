# HMG-ARC-002: Hexagonal Architecture Violation - Incorrect Layer Dependencies

**Title**: Refactor @hexagen/agentic-interaction to comply with hexagonal architecture layer boundaries  
**Description**: The @hexagen/agentic-interaction package violates hexagonal architecture principles by having incorrect layer dependencies:

- Application layer imports from domain and shared layers (should only import domain + port interfaces)
- Infrastructure layer imports from domain and application layers (should only import application ports)  
  **Priority**: High  
  **Component**: Architecture  
  **Impact**: Risk of bypassing architectural guards, enabling unauthorized architecture changes that could corrupt core domain logic  
  **Expected Behavior**: Strict adherence to layer boundaries per manifest.yaml  
  **Actual Behavior**: Cross-layer imports creating tight coupling  
  **Fix**:

1. Move domain logic (entities, value objects) to domain layer
2. Move use cases and port interfaces to application layer
3. Move adapters to infrastructure layer
4. Ensure no framework code (Next.js, browser APIs) in domain/application layers
5. Verify all cross-package imports go through published index.ts

**Status**: In Progress
