// @hexagen-server-only
/**
 * Worked example: an MCP tool is an INBOUND ADAPTER over an existing use-case —
 * validate input, call the use-case, map its `Result` to an MCP response. No
 * business logic lives here; the hexagon is untouched. Copy this file to add a
 * real tool, then register it in `registry/register-all.ts`.
 *
 * Two patterns to keep when you copy it:
 *  1. **Explicit `Result` -> MCP mapping, including the error path** (`isError:
 *     true`). If the error path is glossed over here, every tool copied from it
 *     will gloss over it too.
 *  2. **`dry_run`** for any tool that mutates state (ADR-0010 #5): validate and
 *     report what *would* happen, change nothing.
 */
import { z } from "zod";
import type { RegisteredTool, ToolResult } from "../registry/tool-registry.js";

// A discriminated Result — your real use-cases already return one of these.
// Replace `greetUseCase` with a call into your application layer.
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function greetUseCase(input: {
  name: string;
  dryRun: boolean;
}): Promise<Result<string>> {
  if (input.name.trim() === "") {
    return { ok: false, error: "name must not be empty" };
  }
  if (input.dryRun) {
    return { ok: true, value: `[dry-run] would greet ${input.name}` };
  }
  return { ok: true, value: `Hello, ${input.name}, from {server_name}!` };
}

const InputSchema = {
  name: z.string().describe("Who to greet"),
  dry_run: z
    .boolean()
    .optional()
    .describe("Validate and report the action without performing it"),
};

export const exampleTool: RegisteredTool = {
  name: "greet",
  description: "Example tool — greets a name. Replace with a real use-case.",
  inputSchema: InputSchema,
  handler: async (raw): Promise<ToolResult> => {
    // 1. Validate the untrusted input at the boundary.
    const parsed = z.object(InputSchema).safeParse(raw);
    if (!parsed.success) {
      return {
        content: [
          { type: "text", text: `Invalid input: ${parsed.error.message}` },
        ],
        isError: true,
      };
    }

    // 2. Call the use-case.
    const result = await greetUseCase({
      name: parsed.data.name,
      dryRun: parsed.data.dry_run ?? false,
    });

    // 3. Map the Result to an MCP response — BOTH branches, explicitly.
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: result.value }] };
  },
};
