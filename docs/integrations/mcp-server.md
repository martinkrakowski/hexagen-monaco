# HexaGen Monaco MCP Server

This document explains how the HexaGen Monaco MCP server is implemented, what it exposes, and how to use it from OpenCode and other MCP clients.

## What It Is

`@hexagen/mcp-server` is a stdio MCP server that gives AI agents controlled access to HexaGen architecture operations.

- Transport: JSON-RPC over stdio
- Server identity: `hexagen-mcp-engine` `0.1.0`
- Entry point: `packages/mcp-server/src/cli.ts`
- Composition root: `packages/mcp-server/src/index.ts`

The server is intentionally quiet in the terminal. It does not print startup banners because it is designed to communicate only through MCP protocol messages.

## Implementation Summary

The package follows hexagonal architecture:

- Application layer defines use cases and ports
- Infrastructure layer implements adapters (sync engine, manifest IO, linter, event bus, MCP SDK bridge)
- Composition root wires use cases to adapters
- CLI bootstraps the default composition using `process.cwd()` as workspace root

### Core Files

- `packages/mcp-server/src/cli.ts` - executable startup wrapper
- `packages/mcp-server/src/index.ts` - default dependency wiring and `startDefaultMCPServer`
- `packages/mcp-server/src/infrastructure/adapters/mcp-server.adapter.ts` - MCP request handlers (`tools/list`, `tools/call`, `resources/list`, `resources/read`)
- `packages/mcp-server/src/infrastructure/adapters/sync-engine.adapter.ts` - bridges to architecture graph/lint/scaffolding/port+adapter generation
- `packages/mcp-server/src/infrastructure/adapters/manifest-write.adapter.ts` - dependency validation + manifest update
- `packages/mcp-server/src/infrastructure/adapters/project-configuration-read.adapter.ts` - manifest read
- `packages/mcp-server/src/infrastructure/adapters/linter.adapter.ts` - linter facade
- `packages/mcp-server/src/infrastructure/adapters/in-memory-event-bus.adapter.ts` - event publishing for write actions

### Runtime Detail Worth Knowing

`mcp-server.adapter.ts` loads `@modelcontextprotocol/sdk` modules with dynamic imports at runtime. This avoids bundling issues in the workspace (especially around `node:` resolution in web builds).

## Exposed MCP Resources

### 1) `architecture://manifest`

Returns architecture manifest data (JSON text payload) from project configuration.

### 2) `architecture://graph`

Returns architecture dependency graph generated from manifest context relationships.

### 3) `architecture://linter-report`

Returns architecture lint report. Internally this runs the architecture lint flow and normalizes output.

## Exposed MCP Tools

### `hexagen_audit_boundaries`

Runs boundary auditing through the linter port.

- Input: `{ dry_run?: boolean }`
- Behavior: returns structured report
- Default: dry run behavior is true when not provided

### `hexagen_scaffold_module`

Scaffolds a new package/module in a selected layer.

- Input: `{ name: string, layer: "domain" | "application" | "infrastructure", dry_run?: boolean }`
- On success (non-dry run): creates package files and publishes `ModuleScaffolded`

### `hexagen_add_dependency`

Validates and applies dependency relationships in architecture manifest.

- Input: `{ source_module: string, target_module: string, dry_run?: boolean }`
- Workflow: validate -> apply -> publish `DependencyAdded`

### `hexagen_create_port`

Generates a port contract file under the target bounded context.

- Input: `{ domain_name: string, port_name: string, type: "inbound" | "outbound", dry_run?: boolean }`

### `hexagen_create_adapter`

Generates an infrastructure adapter for a given port.

- Input: `{ port_name: string, infrastructure_name: string, dry_run?: boolean }`

## Service Behaviors

### Read Services

- Manifest read via project configuration adapter
- Graph generation from bounded context + dependency lists
- Linter report produced by architecture lint flow

### Write Services

- Module scaffolding writes package skeleton + index/tsconfig/package metadata
- Port and adapter generation creates files in expected layer directories
- Dependency update modifies manifest after validation

### Event Emission

Write operations publish events to the event bus (`ModuleScaffolded`, `DependencyAdded`) so other systems (like the TUI) can react.

### Error Handling

- Port/adapters use `Result<T, E>` patterns internally
- MCP adapter converts failures into MCP tool error payloads (`isError: true`)
- Unknown tools/resources return explicit errors

## Build and Run

From repo root:

```bash
yarn workspace @hexagen/mcp-server build
yarn workspace @hexagen/mcp-server start
```

Or run all workspace checks:

```bash
yarn build && yarn typecheck && yarn lint
```

## MCP Verification Commands

List tools:

```bash
npx @modelcontextprotocol/inspector --cli --transport stdio --method tools/list -- node packages/mcp-server/dist/cli.js
```

List resources:

```bash
npx @modelcontextprotocol/inspector --cli --transport stdio --method resources/list -- node packages/mcp-server/dist/cli.js
```

Raw initialize handshake:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"tools":{},"resources":{}},"clientInfo":{"name":"test-client","version":"1.0.0"}}}' | node packages/mcp-server/dist/cli.js
```

## Connecting OpenCode

To connect OpenCode to your custom MCP server, declare it in OpenCode config.

### 1) Project-Specific Setup

Create `.opencode.json` in the project root:

```json
{
  "mcp": {
    "hexagen-monaco": {
      "type": "local",
      "command": ["node", "./packages/mcp-server/dist/cli.js"],
      "enabled": true,
      "environment": {
        "ENV_VAR_NAME": "value"
      }
    }
  }
}
```

Note: the `command` array is exactly how the server is launched. You can swap runtime if needed.

### 2) Global Setup

Use either:

- `~/.opencode.json`
- `~/.config/opencode/.opencode.json`

Example with absolute paths:

```json
{
  "mcp": {
    "hexagen-monaco": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/to/hexagen-monaco/packages/mcp-server/dist/cli.js"
      ],
      "enabled": true
    }
  }
}
```

### 3) Remote Deployment

If you host MCP remotely:

```json
{
  "mcp": {
    "hexagen-remote": {
      "type": "remote",
      "url": "https://mcp.krakowski.cloud/endpoint"
    }
  }
}
```

### OpenCode Verification

After saving config and starting OpenCode:

- Run `opencode mcp list` in terminal
- Or use `/mcp` inside OpenCode UI

Reference walkthrough:

- [Connecting Custom Tools to OpenCode](https://www.youtube.com/watch?v=nUCwPxMgz_8)

## Operational Notes

- No visible logs at startup is expected for stdio MCP servers
- Workspace root matters: run from repo root or configure command/cwd accordingly
- Use `dry_run` before write tools when integrating with autonomous agents
- Pair with TUI (`@hexagen/tui`) for live architecture visualization + AI action loop
