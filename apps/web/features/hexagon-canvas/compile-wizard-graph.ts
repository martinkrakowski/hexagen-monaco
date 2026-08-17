import type { WizardData } from "@hexagen/project-configuration";
import type {
  GenerateHexagonalMapPort,
  RenderableHexagonEdge,
  RenderableHexagonNode,
} from "@hexagen/visualization";
import { wizardDataToHexagonalMapInput } from "@hexagen/visualization";
import type { MapNodeVisualUseCase } from "@hexagen/ui-projection-compiler";
import { nodeKindFromHexagonType } from "@hexagen/ui-projection-compiler";

import { computeAddOnOverlay, type AddOnMetaLookup } from "./addon-overlay";
import {
  annotateCompassNodes,
  buildStripChips,
  overlayContextsFrom,
  type AddOnChipNode,
} from "./addon-overlay-nodes";

/**
 * The wizard → canvas graph compile, as a pure function (REA-004).
 *
 * This was `regenerateGraphFromWizard`, a `useCallback` inside `useCanvasState`
 * that reached module-level `wire` singletons and the generated
 * `TEMPLATE_MANIFESTS` import directly. Sitting inside the hook, it could only
 * be exercised by rendering the hook, and any layout-I/O tick in that hook
 * re-created it. It is neither React nor I/O: given the same wizard document
 * and the same collaborators it returns the same graph.
 *
 * Every collaborator is a parameter — including the template-manifest lookup,
 * which was a module import. That is what makes the function testable without
 * a container, and what makes the dependency visible at the call site rather
 * than hidden three files down.
 */

/** The projection port, narrowed to what this compile actually invokes. */
export type NodeVisualMapper = Pick<MapNodeVisualUseCase, "execute">;

export interface CompileWizardGraphDeps {
  readonly generateMap: GenerateHexagonalMapPort;
  /**
   * Optional: the container returns `undefined` when the projection compiler is
   * not wired, and the canvas still draws — just without variant colours.
   */
  readonly mapNodeVisual?: NodeVisualMapper;
  /** Template manifest lookup, for the add-on overlay. */
  readonly templateManifestOf: AddOnMetaLookup;
  /** Display name for an add-on id, for the strip chips. */
  readonly addOnDisplayName: (id: string) => string;
}

export interface CompiledWizardGraph {
  readonly nodes: RenderableHexagonNode[];
  readonly edges: RenderableHexagonEdge[];
  readonly chips: AddOnChipNode[];
}

/** Node types whose visuals the projection compiler resolves. */
const PROJECTED_NODE_TYPES = new Set(["entity", "use-case", "port", "adapter"]);

/**
 * Compile a wizard document into a canvas graph. Returns `null` when the
 * document declares no bounded contexts — there is no map to draw, which is a
 * different outcome from an empty one.
 *
 * Does NOT run ELK and does not touch persistence: the caller decides whether
 * to lay out or to re-apply saved positions.
 */
export function compileWizardGraph(
  wizardData: WizardData | undefined,
  deps: CompileWizardGraphDeps,
): CompiledWizardGraph | null {
  if (!wizardData?.boundedContexts?.length) {
    return null;
  }

  const { nodes, edges } = deps.generateMap.execute({
    map: wizardDataToHexagonalMapInput(wizardData),
  });

  const compiledNodes: RenderableHexagonNode[] = nodes.map((node) => {
    if (!deps.mapNodeVisual || !PROJECTED_NODE_TYPES.has(node.type)) {
      return node;
    }
    const projection = deps.mapNodeVisual.execute({
      nodeId: node.id,
      kind: nodeKindFromHexagonType(node.type, node.side),
      label: node.label,
      category: node.category,
    });
    return {
      ...node,
      category: projection.category,
      compilerCategory: projection.category,
      variant: projection.variant,
    };
  });

  // Add-on overlay (web-only; @hexagen/visualization stays add-on-agnostic):
  // annotate declared compass adapters in place, and build strip chips for
  // platform-zone / shared-kernel add-ons (positioned post-layout).
  const overlayContexts = overlayContextsFrom(wizardData.boundedContexts ?? []);
  const overlay = computeAddOnOverlay(
    wizardData.addOnsAnswers ?? {},
    deps.templateManifestOf,
    overlayContexts,
  );
  annotateCompassNodes(compiledNodes, overlay, overlayContexts);
  const chips = buildStripChips(overlay, deps.addOnDisplayName);

  return { nodes: compiledNodes, edges, chips };
}
