# ADR-0010: MCP Server Architecture

**Date:** 2026-04-07
**Status:** Accepted
**Type:** Architecture

## Context

We needed a standardized way to expose HexaGen Monaco's architectural capabilities to AI agents (OpenCode, Claude Desktop, Cursor) and developer tools. The Model Context Protocol (MCP) provides a well-defined specification for tool and resource exposure, but we had to make implementation choices for:

1. **Transport mechanism** — stdio vs HTTP
2. **SDK integration** — dynamic vs static imports
3. **Architecture pattern** — how to expose use cases through MCP
4. **Tool design** — what operations to expose and their contracts

## Decision

**Implement a stdio MCP server (`@hexagen/mcp-server`) with dynamic SDK loading and hexagonal use-case wiring.**

### Key Implementation Decisions

1. **Stdio transport** — Server communicates via stdin/stdout using JSON-RPC. This is the most portable approach for local AI tool integration.

2. **Dynamic SDK imports** — The MCP SDK (`@modelcontextprotocol/sdk`) is loaded at runtime using `import()` rather than bundled statically. This avoids webpack `node:` scheme resolution errors in `apps/web`.

3. **Hexagonal composition** — MCP request handlers delegate to application use cases, which depend on ports. Adapters implement the ports. This maintains architectural integrity.

4. **Read-only resources + write tools** — Resources expose architectural state (manifest, graph, linter report). Tools expose operations (audit, scaffold, add dependency, create port/adapter).

5. **Dry-run by default for tools** — All write tools accept a `dry_run` parameter. When `true`, validation runs but no files are modified. This allows AI agents to preview changes.

## Rationale

- **OpenCode compatibility** — OpenCode connects to stdio MCP servers with minimal config (`.opencode.json`).
- **Protocol compliance** — Using official MCP SDK ensures compatibility with Claude Desktop, Cursor, and other clients.
- **Separation of concerns** — MCP transport layer is infrastructure. Business logic lives in use cases. Easy to swap transport if needed.
- **Safe AI integration** — Dry-run default prevents autonomous agents from making unintended changes.
- **Event-driven updates** — Write operations publish events (`ModuleScaffolded`, `DependencyAdded`) to a bus so other systems (TUI) can react.

## Risks

- **SDK version drift** — MCP SDK evolves; dynamic loading means version is determined at runtime, not build time.
- **No native logging** — Stdio servers produce no visible console output by design; debugging requires client-side inspection.
- **Workspace root sensitivity** — The server uses `process.cwd()` as workspace root; it must be run from the monorepo root.

## Consequences

### Positive

- AI agents can query architectural state via resources
- AI agents can trigger scaffold/port/adapter generation via tools
- OpenCode, Claude Desktop, Cursor can all connect
- TUI consumes same MCP server as external agents
- Architecture integrity preserved through hexagonal layering

### Negative

- Adds another running process (server) to the system
- Requires separate build (`yarn workspace @hexagen/mcp-server build`)
- Must restart server if package code changes

## Implementation Notes

### Package Structure

```
packages/mcp-server/
├── src/
│   ├── index.ts                    # Composition root
│   ├── cli.ts                      # Entry point
│   ├── application/
│   │   ├── use-cases/              # 8 use cases (3 resources, 5 tools)
│   │   └── ports/out/              # 4 port interfaces
│   └── infrastructure/adapters/   # 7 adapters + MCP server bridge
```

### Exposed Resources

| URI                            | Description                         |
| ------------------------------ | ----------------------------------- |
| `architecture://manifest`      | Current architecture manifest       |
| `architecture://graph`         | Bounded context dependency graph    |
| `architecture://linter-report` | Latest architecture lint violations |

### Exposed Tools

| Tool                       | Input                                          | Behavior                      |
| -------------------------- | ---------------------------------------------- | ----------------------------- |
| `hexagen_audit_boundaries` | `{ dry_run?: boolean }`                        | Run linter, return violations |
| `hexagen_scaffold_module`  | `{ name, layer, dry_run? }`                    | Create package skeleton       |
| `hexagen_add_dependency`   | `{ source_module, target_module, dry_run? }`   | Validate + update manifest    |
| `hexagen_create_port`      | `{ domain_name, port_name, type, dry_run? }`   | Create port contract file     |
| `hexagen_create_adapter`   | `{ port_name, infrastructure_name, dry_run? }` | Create adapter file           |

## References

- `.architecture/manifest.yaml` — bounded context definitions
- `packages/mcp-server/src/index.ts` — composition root implementation
- MCP specification: https://modelcontextprotocol.io
- OpenCode MCP integration: https://github.com/anomalyco/opencode
- YouTube: Connecting Custom Tools to OpenCode
