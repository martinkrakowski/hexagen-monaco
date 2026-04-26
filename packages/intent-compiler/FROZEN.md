# @hexagen/intent-compiler — Phase 2a: Unfrozen

**Status:** Unfrozen as of Phase 2a

## What Changed

All infrastructure adapters have been implemented and concrete instances now replace mock stubs:

- ✅ `ManifestAwareGestureParserAdapter` — parses structured UI gestures into ParsedGesture with DomainAST
- ✅ `TopologyValidatorAdapter` — validates DomainAST against topology invariants (acyclic, containment, degree, connected)
- ✅ `CardinalityValidatorAdapter` — validates DomainAST against cardinality invariants (exactly, atLeast, atMost, between)
- ✅ `ConsoleRejectEmitterAdapter` — emits validation rejections to console logger
- ✅ `ParseGestureUseCase` — fully orchestrates the parsing and validation pipeline

## Architecture

### Intent Compilation Pipeline

```
Gesture Input
    ↓
[ManifestAwareGestureParserAdapter]
    ↓
ParsedGesture with DomainAST
    ↓
[TopologyValidatorAdapter] → Validates graph structure
    ↓
[CardinalityValidatorAdapter] → Validates node counts
    ↓
ParseGestureUseCase Output (or Rejection emitted)
```

### Ports

**In-Ports (driven by application):**

- `GestureParserPort` → implemented by `ManifestAwareGestureParserAdapter`
- `TopologyCheckerPort` → implemented by `TopologyValidatorAdapter`
- `CardinalityCheckerPort` → implemented by `CardinalityValidatorAdapter`
- `RejectEmitterPort` → implemented by `ConsoleRejectEmitterAdapter`

**Out-Ports:** None

### Use Cases

- `ParseGestureUseCase` — Main orchestrator, coordinates all adapters
- `ValidateTopologyUseCase` — Isolated topology validation (legacy)
- `ValidateCardinalityUseCase` — Isolated cardinality validation (legacy)
- `EmitRejectionUseCase` — Isolated rejection emission (legacy)

## Validation Rules

### Topology Invariants

Supported invariant types in `DomainAST.invariants.topology`:

1. **Acyclic** — ensures no cycles in specified edge kinds
2. **Containment** — ensures edges only connect specific node type pairs
3. **DegreeConstraint** — enforces min/max edge cardinality per node
4. **Connected** — ensures all nodes are reachable via specified edges

### Cardinality Invariants

Supported invariant types in `DomainAST.invariants.cardinality`:

1. **Exactly** — enforces exact node count
2. **AtLeast** — enforces minimum node count
3. **AtMost** — enforces maximum node count
4. **Between** — enforces range-based node count

## Testing

Comprehensive test suite added for all adapters:

- Unit tests for each adapter in isolation
- Integration tests for full ParseGestureUseCase pipeline
- Edge case coverage (empty AST, missing invariants, partial payloads)

## Future Work

- Integration with Phase 2b (AI-driven prompt compilation)
- Integration with Phase 3 (wizard orchestration)
- Augment ConsoleRejectEmitterAdapter with structured logging/telemetry
- Add performance metrics for validation pipeline
