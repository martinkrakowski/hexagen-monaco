import type { Grant } from "../../../application/kernel/grant.js";
import type { ToolDefinition } from "./tool-definition.js";

export const proposePatchTool: ToolDefinition = {
  name: "hexagen_propose_patch",
  description:
    "Propose a unified diff for a client repo. PROPOSE-ONLY: this tool never applies the patch and never writes to the working tree; an allowed patch is stored under .hexagen/proposals/<id>.patch (with <id>.json) and the FDE applies it with `git apply -p1`. Every touched path (both sides of a rename or copy) must be allowed by the signed Grant (its `tools` must name hexagen_propose_patch) AND lie inside .hexagen/slice.json (inside `paths`, outside `excludes`), including the on-disk spelling of each path. Symlink and submodule modes, binary patches, quoted paths that cannot be decoded safely and patches over 1 MiB are refused. Every call, allowed or denied, appends a trace line whose goal_id is the slice id.",
  inputSchema: {
    type: "object",
    properties: {
      patch: {
        type: "string",
        description:
          "A git-style unified diff (`git diff` output: `diff --git a/<p> b/<p>` headers, paths relative to the repo root, applied with -p1).",
      },
      grant: {
        type: "object",
        description:
          'The signed Grant authorizing this call (docs/kernel/GRANT.md). Required: a call with no grant, or a grant with no id, is denied and recorded as grant_missing. A propose-only grant carries mode "propose"; the mode is not checked.',
      },
      goal_id: {
        type: "string",
        description:
          "Opaque id for what prompted this call. The trace's goal_id is the slice id; this is used only when there is no usable slice.",
      },
    },
    required: ["patch", "grant"],
  },
  handler: async (args, deps) => {
    const a = args as Record<string, unknown>;
    const result = await deps.proposePatchToolUseCase.execute({
      patch: a.patch,
      grant: a.grant as Grant | undefined,
      goal_id: typeof a.goal_id === "string" ? a.goal_id : undefined,
    });
    return {
      ...(result.allowed ? {} : { isError: true }),
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  },
};
