# Core Implementation Roadmap

**Workstream:** Core Implementation

## High-Level Status

- **Foundational MVK and projection kernel isolation** — complete.
- **Execution DAG**: First major vertical slices delivered.
- **Transaction System**: Core semantics and lifecycle delivered.
- **Probabilistic Layer**: Prompt compiler, LLM ACLs, and reconciliation largely in place.
- **System Verification**: In flight — property testing, accessibility, and budget validation.
- **Composition-Root Purification**: In flight — extraction of remaining kernel logic from the app layer.

## Near-Term Priorities (at time of original plan)

1. Finish the System Verification gates at scale.
2. Complete the Composition-Root Purification extractions and put permanent enforcement in place.
3. Maintain architectural invariants while the final workstreams land.

For detailed per-workstream focus and links, see the [Core Implementation Overview](overview.md).
