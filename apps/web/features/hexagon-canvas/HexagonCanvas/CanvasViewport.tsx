"use client";

import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CanvasViewportProps } from "./types";
import { AddOnLegend } from "../AddOnLegend";
import { useMemo } from "react";

/** Static proOptions — never changes, hoisted to module scope to avoid per-render allocation. */
const PRO_OPTIONS = { hideAttribution: true } as const;

export function CanvasViewport({
  nodes,
  edges,
  nodeTypes: nodeTypesMap,
  isValidConnection,
  onNodeDragStop,
  onNodeDoubleClick,
  colorMode,
}: CanvasViewportProps) {
  const theme = colorMode === "dark" ? "dark" : "light";

  // Memoize the background color derivation — only recompute when theme changes.
  // Avoids calling getComputedStyle on every render (synchronous DOM read).
  const bgColor = useMemo(() => {
    const fallback = theme === "dark" ? "35 5% 35%" : "35 5% 65%";
    if (typeof document === "undefined") {
      return `hsl(${fallback} / 0.4)`;
    }
    const cssValue = getComputedStyle(document.documentElement)
      .getPropertyValue("--muted-foreground")
      .trim();
    return `hsl(${cssValue || fallback} / 0.4)`;
  }, [theme]);

  // Show the add-on legend only when the overlay is present (annotated adapter
  // or a strip chip), so add-on-free diagrams stay uncluttered.
  const hasAddOns = useMemo(
    () =>
      nodes.some(
        (n) =>
          n.type === "addon-chip" ||
          Boolean((n.data as { addOn?: unknown } | undefined)?.addOn),
      ),
    [nodes],
  );

  return (
    <div className="w-full h-full min-h-96">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypesMap}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        isValidConnection={isValidConnection}
        fitView
        colorMode={colorMode}
        className="bg-card"
        proOptions={PRO_OPTIONS}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          color={bgColor}
          style={{ opacity: 0.8 }}
        />
        <Controls className="bg-card border border-border shadow-md rounded-lg [&_.react-flow__controls-button]:border-border [&_.react-flow__controls-button]:bg-card [&_.react-flow__controls-button]:text-foreground" />
        {hasAddOns ? (
          <Panel position="bottom-left" style={{ marginBottom: 150 }}>
            <AddOnLegend />
          </Panel>
        ) : null}
      </ReactFlow>
    </div>
  );
}
