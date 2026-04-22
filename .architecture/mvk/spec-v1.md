---
mvk-compilation-pass: cp-2026-04-20-01
pass-snapshot-sha: b061ccdb2c4b989a74fcd45130534e89c0926a04
co-emitted-siblings:
  - .architecture/mvk/drift-report-v1.md
  - .architecture/decisions/0018-mvk-semantic-kernel-contracts.md
  - packages/core-domain/src/mvk/v1/index.ts
mvk-target-version: v1
rrp-target-version: v1
emission-phase: 2.0
---

# MVK Specification v1

## Purpose & Non-Goals

**Purpose**: Define the compiled contract intermediate representation (MVK) that serves as the canonical semantic boundary between the deterministic kernel, projection system, and probabilistic layer in HexaGen Monaco.

**Non-Goals**:

- This specification does not define implementation details of the kernel, projection, or probabilistic systems
- This specification does not include runtime behavior or execution semantics
- Visual rendering details are deferred to the projection system (NodeVisualSpec is stubbed)
- Lifecycle rules and naming conventions are deferred to later phases

## Three-Plane Topology Context

Per ADR-0018, HexaGen Monaco consists of three non-interacting planes:

1. **Deterministic Kernel**: Semantic truth, rule resolution, execution (MVK contracts)
2. **Projection System**: Render derived state only (UI framebuffer, layout solver)
3. **Probabilistic Layer**: Observational validation, annotation (LLM outputs, heuristics)

The MVK specification defines the contract surface that isolates these planes.

## Authority Model

- **MVK Spec = Canonical** (human truth, authoritative source of meaning)
- **TypeScript = Structural Validator** (machine enforcement of contract shape)
- **MVK Itself = Compiled Artifact** (neither spec nor TS, but the instantiation of both)

## DomainAST

The Domain Abstract Syntax Tree represents the immutable semantic structure of the system.

```
DomainAST ::= {
  nodes: DomainNode[],
  edges: DomainEdge[],
  invariants: Invariants
}

DomainNode ::= {
  id: Identifier,
  kind: NodeKind,
  attributes: Record<string, unknown>
}

DomainEdge ::= {
  id: Identifier,
  kind: EdgeKind,
  source: Identifier,
  target: Identifier,
  attributes: Record<string, unknown>
}

Invariants ::= {
  topology: TopologyInvariants[],
  cardinality: CardinalityInvariants[]
}
```

## NodeKind Taxonomy (exhaustive enum)

```
enum NodeKind {
  // Core structural elements
  "BoundedContext",
  "Entity",
  "ValueObject",
  "Port",
  "UseCase",
  "Adapter",
  "Driver",

  // Infrastructure elements
  "PersistenceAdapter",
  "MessagingAdapter",
  "ExternalIntegrationAdapter",

  // Application elements
  "Controller",
  "Presenter",
  "Gateway",

  // Domain elements
  "Aggregate",
  "DomainEvent",
  "Policy",

  // Specialized elements
  "Repository",
  "Factory",
  "Service",

  // Extensibility point
  "Extension"
}
```

## EdgeKind Taxonomy + Directionality

```
enum EdgeKind {
  // Structural relationships
  "Composition",
  "Aggregation",
  "Dependency",
  "Inheritance",
  "Realization",

  // Behavioral relationships
  "Invocation",
  "Subscription",
  "Implementation",

  // Dependency relationships
  "Usage",
  "Import",
  "Include",

  // Specialized relationships
  "PortBinding",
  "AdapterImplementation",
  "UseCaseRealization"
}

// Directionality defines whether edges are directed, undirected, or bidirectional
type EdgeDirectionality =
  | "directed"    // Source → Target only
  | "undirected"  // Source ↔ Target (no inherent direction)
  | "bidirectional" // Source ↔ Target with semantic meaning in both directions

// Mapping of EdgeKind to directionality
const EDGE_DIRECTIONALITY: Record<EdgeKind, EdgeDirectionality> = {
  "Composition": "directed",
  "Aggregation": "directed",
  "Dependency": "directed",
  "Inheritance": "directed",
  "Realization": "directed",
  "Invocation": "directed",
  "Subscription": "directed",
  "Implementation": "directed",
  "Usage": "directed",
  "Import": "directed",
  "Include": "directed",
  "PortBinding": "bidirectional",
  "AdapterImplementation": "directed",
  "UseCaseRealization": "directed"
};
```

## DomainCommand Discriminated Union

```
type DomainCommand =
  | {
      type: "CreateNode";
      payload: {
        kind: NodeKind;
        attributes: Record<string, unknown>;
      }
    }
  | {
      type: "UpdateNode";
      payload: {
        nodeId: Identifier;
        attributes: Partial<Record<string, unknown>>;
      }
    }
  | {
      type: "DeleteNode";
      payload: {
        nodeId: Identifier;
      }
    }
  | {
      type: "CreateEdge";
      payload: {
        kind: EdgeKind;
        source: Identifier;
        target: Identifier;
        attributes: Record<string, unknown>;
      }
    }
  | {
      type: "UpdateEdge";
      payload: {
        edgeId: Identifier;
        attributes: Partial<Record<string, unknown>>;
      }
    }
  | {
      type: "DeleteEdge";
      payload: {
        edgeId: Identifier;
      }
    }
  | {
      type: "Batch";
      payload: {
        commands: DomainCommand[];
      }
    };
```

## RRP v1 Shape

```
type ResolvedRuleProgram = {
  version: string; // RRP version (e.g., "v1")
  contextHash: string; // Hash of resolved context (workspace/user/deployment)
  ruleSetHash: string; // Hash of active governance rules
  nodes: ResolvedNode[];
  edges: ResolvedEdge[];
  topologicalOrder: Identifier[]; // For deterministic processing
};

type ResolvedNode = {
  id: Identifier;
  kind: NodeKind;
  attributes: Record<string, unknown>;
  // Computed fields from rule resolution
  computedAttributes: Record<string, unknown>;
  validity: {
    valid: boolean;
    violations: string[]; // Human-readable violation descriptions
  };
};

type ResolvedEdge = {
  id: Identifier;
  kind: EdgeKind;
  source: Identifier;
  target: Identifier;
  attributes: Record<string, unknown>;
  // Computed fields from rule resolution
  computedAttributes: Record<string, unknown>;
  validity: {
    valid: boolean;
    violations: string[];
  };
};
```

## REM v1 Shape

```
type RuleExecutionManifest = {
  version: string; // REM version (e.g., "v1")
  contextHash: string; // Must match RRP.contextHash
  ruleSetHash: string; // Must match RRP.ruleSetHash
  rrpHash: string; // Hash of the source RRP
  manifest: {
    nodes: ManifestNode[];
    edges: ManifestEdge[];
  };
  // Cryptographic seal ensuring immutability
  seal: string; // HMAC-SHA256 of manifest contents using ruleSetHash as key
};

type ManifestNode = {
  id: Identifier;
  kind: NodeKind;
  attributes: Record<string, unknown>;
};

type ManifestEdge = {
  id: Identifier;
  kind: EdgeKind;
  source: Identifier;
  target: Identifier;
  attributes: Record<string, unknown>;
};
```

## NodeVisualSpec v1 Shape (stubbed — projection boundary only)

```
type NodeVisualSpec = {
  // Core identity
  nodeId: Identifier;

  // Visual properties (to be computed by projection system)
  position: { x: number; y: number };
  size: { width: number; height: number };

  // Styling (theme-dependent)
  style: {
    backgroundColor: string; // HSL format
    borderColor: string; // HSL format
    textColor: string; // HSL format
  };

  // Icon metadata (semantic → visual mapping handled by projection)
  icon: {
    name: string; // Logical icon name
    color: string; // HSL format
  };

  // Label and text content
  label: string;
  tooltip?: string;

  // Interaction state (projection-only, not part of kernel)
  // NOTE: These fields exist only in the projection system, not in MVK
  // interactionState: {
  //   hovered: boolean;
  //   selected: boolean;
  //   dragged: boolean;
  // };

  // Affordances (computed by projection system based on kernel semantics)
  affordances: {
    movable: boolean;
    resizable: boolean;
    connectable: boolean;
    deletable: boolean;
  };
};
```

## IntentLineage v1 Shape

```
type IntentLineage = {
  // Unique identifier for this intent sequence
  intentId: string; // Format: intentId_vN where N is version number

  // Parent intent in causal chain (null for root intents)
  parentIntentId?: string;

  // Timestamp of intent creation
  timestamp: number; // Unix milliseconds

  // Origin of intent
  origin:
    | { type: "user"; actorId: string } // Direct user action
    | { type: "system"; trigger: string } // System-generated
    | { type: "llm"; modelId: string; promptHash: string }; // LLM-generated

  // Version contract this intent targets
  targetContract: {
    mvkVersion: string;
    rrpVersion: string;
    remVersion: string;
  };

  // Validation status
  validation: {
    valid: boolean;
    reason?: string; // Human-readable explanation if invalid
  };
};
```

## Topology Invariants (Q3a subset)

Type-level invariants that enforce structural constraints on the DomainAST:

```
type TopologyInvariants =
  | {
      type: "Acyclic";
      payload: {
        // Ensures no cycles in specified edge kinds
        appliesTo: EdgeKind[];
      }
    }
  | {
      type: "Connected";
      payload: {
        // Ensures all nodes are reachable via specified edge kinds
        edgeKinds: EdgeKind[];
        // Optional: root nodes that must be able to reach all others
        rootNodeKinds?: NodeKind[];
      }
    }
  | {
      type: "Containment";
      payload: {
        // Ensures edges of certain kinds only connect specific node types
        source: NodeKind;
        edgeKind: EdgeKind;
        target: NodeKind;
      }
    }
  | {
      type: "DegreeConstraint";
      payload: {
        // Constrains number of edges of a kind connected to a node
        edgeKind: EdgeKind;
        min: number;
        max: number;
        appliesTo: NodeKind[]; // If empty, applies to all nodes
      }
    };
```

## Cardinality Invariants (Q3b subset)

Type-level invariants that enforce quantity constraints:

```
type CardinalityInvariants =
  | {
      type: "Exactly";
      payload: {
        // Exactly N instances of node kind must exist
        nodeKind: NodeKind;
        count: number;
      }
    }
  | {
      type: "AtLeast";
      payload: {
        // At least N instances of node kind must exist
        nodeKind: NodeKind;
        count: number;
      }
    }
  | {
      type: "AtMost";
      payload: {
        // At most N instances of node kind must exist
        nodeKind: NodeKind;
        count: number;
      }
    }
  | {
      type: "Between";
      payload: {
        // Between min and max instances (inclusive) of node kind must exist
        nodeKind: NodeKind;
        min: number;
        max: number;
      }
    };
```

## Versioning Rules

- **SemVer Protocol**: MVK follows semantic versioning where:
  - PATCH version: Backward-compatible bug fixes
  - MINOR version: Backward-compatible new features
  - MAJOR version: Breaking changes requiring migration
- **Migration Function Contract**: When introducing breaking changes (MAJOR version), provide:
  ```ts
  type MigrationFunction<TFrom, TTo> = (
    input: TFrom,
  ) => Result<TTo, MigrationError>;
  ```
- **REM Version-Lock Guarantee**: A REM is cryptographically bound to exactly one versionset:
  - One REM binds to exactly one {MVK version, RRP version, REM version} triplet
  - Mixed-version transactions are prohibited by design

## Drift Appendix

This section cross-references the drift report to show what was discovered during the initial survey:

- See `.architecture/mvk/drift-report-v1.md` for detailed audit findings
- No implicit types were found in the initial survey of 11 source locations
- All identified types in this spec are newly introduced as part of the MVK contract

## Explicitly Deferred Concerns

The following concerns are intentionally deferred to later phases:

- **Naming rules (Q3c)**: Convention for auto-generating identifiers from semantic names
- **Lifecycle rules (Q3d)**: Rules governing creation, modification, and deletion of elements
- **Layout solver implementation**: Concrete constraint satisfaction algorithms (Phase 3)
- **Projection compiler implementation**: DomainAST → NodeVisualSpec mapping (Phase 3)
- **Intent Compiler VM**: Gesture parsing and validation logic (Phase 3)
- **Transaction Manager**: Intent binding, REM association, and dispatch logic (Phase 4)
