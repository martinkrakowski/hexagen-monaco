import type {
  ArchitectureGraphLike,
  Patch,
  ProjectSpecLike,
  ReconciliationResult,
} from "../../domain/llm-response.js";
import {
  createPatch,
  createReconciliationResult,
} from "../../domain/llm-response.js";
import type { ReconciliationPort } from "../../application/ports/in/reconcile.port.js";
import type { ReconcileRequest } from "../../application/ports/in/reconcile.port.js";

export class StructuredDiffReconciliationAdapter implements ReconciliationPort {
  async reconcile(request: ReconcileRequest): Promise<ReconciliationResult> {
    const { structuredOutput, currentManifest } = request;
    const errors: string[] = [];

    const contextPatches = this.diffBoundedContexts(
      structuredOutput.manifest,
      currentManifest,
    );
    const nodePatches = this.diffNodes(structuredOutput.architectureGraph);
    const edgePatches = this.diffEdges(structuredOutput.architectureGraph);

    const allPatches = [...contextPatches, ...nodePatches, ...edgePatches];

    if (errors.length > 0) {
      return createReconciliationResult(false, allPatches, errors);
    }

    return createReconciliationResult(
      true,
      allPatches,
      [],
      allPatches.length > 0
        ? `Generated ${allPatches.length} patches from structured diff`
        : "No differences detected",
    );
  }

  private diffBoundedContexts(
    proposed: ProjectSpecLike,
    current: ProjectSpecLike,
  ): Patch[] {
    const patches: Patch[] = [];
    const proposedContexts = proposed.boundedContexts ?? [];
    const currentContexts = current.boundedContexts ?? [];

    const currentById = new Map(currentContexts.map((c) => [c.id, c]));
    const proposedById = new Map(proposedContexts.map((c) => [c.id, c]));

    for (const proposed of proposedContexts) {
      const existing = currentById.get(proposed.id);
      if (!existing) {
        patches.push(
          createPatch("add_node", proposed.id, {
            name: proposed.name,
            nodeType: "bounded-context",
          }),
        );
      } else if (existing.name !== proposed.name) {
        patches.push(
          createPatch("update_node", proposed.id, {
            name: proposed.name,
            previousName: existing.name,
          }),
        );
      }
    }

    for (const current of currentContexts) {
      if (!proposedById.has(current.id)) {
        patches.push(
          createPatch("remove_node", current.id, {
            name: current.name,
            nodeType: "bounded-context",
          }),
        );
      }
    }

    return patches;
  }

  private diffNodes(graph: ArchitectureGraphLike): Patch[] {
    const patches: Patch[] = [];

    for (const node of graph.nodes) {
      if (node.status === "added" || node.status === "new") {
        patches.push(
          createPatch("add_node", node.id, {
            label: node.label,
            type: node.type,
          }),
        );
      } else if (node.status === "removed" || node.status === "deleted") {
        patches.push(
          createPatch("remove_node", node.id, {
            label: node.label,
            type: node.type,
          }),
        );
      } else if (node.status === "modified" || node.status === "updated") {
        patches.push(
          createPatch("update_node", node.id, {
            label: node.label,
            type: node.type,
          }),
        );
      }
    }

    return patches;
  }

  private diffEdges(graph: ArchitectureGraphLike): Patch[] {
    const patches: Patch[] = [];

    for (const edge of graph.edges) {
      if (!edge.isValid && edge.violationReason) {
        patches.push(
          createPatch("remove_edge", `${edge.source}-${edge.target}`, {
            source: edge.source,
            target: edge.target,
            relationship: edge.relationship,
            violationReason: edge.violationReason,
          }),
        );
      }
    }

    return patches;
  }
}
