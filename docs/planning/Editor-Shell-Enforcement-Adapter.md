# Architectural Feature Plan: Editor/Shell Enforcement Adapter

## 1. Problem Statement

The current security perimeter of the governance kernel relies on an out-of-process Model Context Protocol (MCP) server layer to intercept and gate system modifications. While the core manifest mutation tools are securely bound by cryptographic Grant verification, this architecture possesses a significant structural blind spot:

- **Non-MCP Editor Exploits:** Inline IDE agents bypass the tool calling surface entirely by executing raw filesystem mutations straight to the workspace buffer.
- **Unmonitored Execution Paths:** Terminal agents or semi-autonomous execution hooks can invoke destructive shell scripts directly inside the workstation environment without triggering tool-level gatechecks.

To maintain strict compliance with system invariants, the governance engine requires an execution proxy and filesystem validation layer capable of intercepting ad-hoc actions prior to mutation or process execution.

## 2. Proposed Architecture

Enforcement is shifted from the probabilistic tool layer down to the operating system's process-spawning boundary and filesystem-staging hooks.

┌────────────────────────────────────────────────────────┐
│ AI Agent / Operator Context │
├───────────────────────────┬────────────────────────────┤
│ a) Editor IDE Buffer │ b) Workstation Shell │
└─────────────┬─────────────┴──────────────┬─────────────┘
│ (Buffer Save / Write) │ (Spawns Command via wrap)
▼ ▼
┌───────────────────────────┐┌───────────────────────────┐
│ Workspace Change Hook ││ Targeted Binary Shim │
│ (Staging Lint Matcher) ││ (hexagen verify-exec) │
└─────────────┬─────────────┘└─────────────┬─────────────┘
│ │
└──────────────┬─────────────┘
│ (Forward Action Spec Payload)
▼
┌────────────────────────────────────────────────────────┐
│ packages/mcp-server (Core Lane) │
│ │
│ ┌────────────────────────────────────────────────┐ │
│ │ EditorShellAdapter │ │
│ └───────────────────────┬────────────────────────┘ │
│ │ │
│ ▼ │
│ ┌────────────────────────────────────────────────┐ │
│ │ GrantVerifier Engine │◄──┼─── [.hexagen/grant-signing.key]
│ └───────────────────────┬────────────────────────┘ │
│ │ │
│ ▼ │
│ ┌────────────────────────────────────────────────┐ │
│ │ TraceLogger Service │───┼───► [.hexagen/evidence/trace.jsonl]
│ └────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘

## 3. Core Component Modifications

**packages/mcp-server (Probabilistic/Core Plane)**

- **EditorShellAdapter:** A high-performance infrastructure adapter that ingests low-level intercept signals, maps them to core domain ActionPayload structures, and triggers the fail-closed GrantVerifier.
- **Targeted Exec Shim:** A lightweight executable leveraging the bundled `@hexagen/sync` CLI to verify commands for autonomous terminal agents, avoiding global `bash` interception.

## 4. Technical Implementation & Type Signatures

### Core Enforcement Adapter

```typescript
// packages/mcp-server/src/infrastructure/adapters/EditorShellAdapter.ts

import {
  GrantVerifier,
  EnforcementVerdict,
  ActionPayload,
} from "../../application/kernel/types";
import { TraceLogger } from "./TraceLogger";

export interface FileMutationIntercept {
  filePath: string;
  mutationType: "WRITE" | "DELETE" | "CHMOD";
  originatingAgent: string;
  diffSummary?: string;
}

export interface ProcessExecutionIntercept {
  commandString: string;
  workingDirectory: string;
  environmentVariables: Record<string, string>;
  originatingAgent: string;
}

export class EditorShellAdapter {
  constructor(
    private readonly grantVerifier: GrantVerifier,
    private readonly traceLogger: TraceLogger,
    private readonly signingKeyPath: string,
  ) {}

  public async handleProcessIntercept(
    payload: ProcessExecutionIntercept,
  ): Promise<EnforcementVerdict> {
    const action: ActionPayload = {
      type: "SHELL_EXEC",
      target: payload.commandString,
      context: payload.workingDirectory,
      metadata: {
        agent: payload.originatingAgent,
        timestamp: Date.now().toString(),
      },
    };

    return this.evaluateAndTrace(action, "EXEC_ALLOWED", "EXEC_DENIED");
  }

  public async handleFileMutationIntercept(
    payload: FileMutationIntercept,
  ): Promise<EnforcementVerdict> {
    const action: ActionPayload = {
      type: "FILE_MUTATION",
      target: payload.filePath,
      context: payload.mutationType,
      metadata: {
        agent: payload.originatingAgent,
        timestamp: Date.now().toString(),
      },
    };

    return this.evaluateAndTrace(action, "FILE_ALLOWED", "FILE_DENIED");
  }

  private async evaluateAndTrace(
    action: ActionPayload,
    allowEvent: string,
    denyEvent: string,
  ): Promise<EnforcementVerdict> {
    const verification = await this.grantVerifier.verify(
      action,
      this.signingKeyPath,
    );

    await this.traceLogger.append({
      event: verification.allowed ? allowEvent : denyEvent,
      timestamp: Date.now(),
      payload: action,
      reason: verification.reason,
    });

    if (!verification.allowed) {
      return {
        status: "REJECTED",
        action: "SIGKILL",
        reason: `Governance Breach Enforced: ${verification.reason}`,
      };
    }

    return {
      status: "APPROVED",
      action: "PASS_THROUGH",
    };
  }
}
```

### Targeted Shell Interceptor Hook

This script avoids intercepting all bash commands. It acts as an opt-in wrapper for autonomous agents.

```bash
#!/usr/bin/env bash
# .hexagen/bin/hex-exec
set -euo pipefail

COMMAND_STR="$*"
WORKING_DIR="$(pwd)"
AGENT_ID="${HEXAGEN_AGENT_ID:-untracked-editor-agent}"

# Dispatch payload to bundled CLI surface for verification
VERDICT=$(npx @hexagen/sync verify-exec \
  --cmd "$COMMAND_STR" \
  --cwd "$WORKING_DIR" \
  --agent "$AGENT_ID")

if [ "$VERDICT" == "REJECTED" ]; then
  echo "[-] CRITICAL: Execution blocked by Hexagen Governance Engine." >&2
  exit 1
fi

exec bash -c "$COMMAND_STR"
```

## 5. Verification Matrix & Invariants

- **Verification Protocol:** Reuses existing validation algorithms mapped out under `mcp-server/src/application/kernel/grant.ts`. Any external modification or bash sequence must explicitly present an active, valid HMAC signature derived from `.hexagen/grant-signing.key`.
- **Trace Compliance:** Every passing or blocked interception prints a single-line JSON blob append to `.hexagen/evidence/trace.jsonl` containing high-precision UNIX timestamps for auditing.
- **Fail-Closed Execution:** If the EditorShellAdapter encounters missing signatures, malformed payload specifications, or disk-read timeouts on the key structures, execution falls closed with a clean SIGKILL status payload response.
