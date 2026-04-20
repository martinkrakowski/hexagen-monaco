import type { LLMResponse, ReconciliationResult, DomainASTLike, Patch } from "../../domain/llm-response.js";
import type { ReconciliationPort } from "../../application/ports/in/reconcile.port.js";

export class DefaultASTReconciliationAdapter implements ReconciliationPort {
  async reconcile(request: {
    response: LLMResponse;
    currentAST: DomainASTLike;
    intentId: string;
  }): Promise<ReconciliationResult> {
    const patches: Patch[] = [];
    const errors: string[] = [];

    try {
      const content = request.response.content;

      if (!content || content.trim().length === 0) {
        errors.push("LLM response content is empty");
        return {
          success: false,
          patches: [],
          errors,
          summary: "LLM returned empty content",
        };
      }

      const lines = content.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        if (line.startsWith("+ ")) {
          const nodeMatch = line.match(/\+ (\w+):(\w+)/);
          if (nodeMatch) {
            patches.push({
              id: `patch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
              type: "add_node",
              targetId: nodeMatch[2],
              payload: { label: nodeMatch[2], kind: nodeMatch[1] },
            });
          }
        } else if (line.startsWith("- ")) {
          const nodeMatch = line.match(/- (\w+):(\w+)/);
          if (nodeMatch) {
            patches.push({
              id: `patch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
              type: "remove_node",
              targetId: nodeMatch[2],
              payload: {},
            });
          }
        }
      }

      return {
        success: errors.length === 0,
        patches,
        errors,
        summary: `Applied ${patches.length} patches from LLM response`,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      errors.push(errorMsg);

      return {
        success: false,
        patches: [],
        errors,
        summary: "Error reconciling LLM response",
      };
    }
  }
}