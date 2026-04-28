"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { useCanvasState } from "./hooks/useCanvasState";
import { useCanvasHistory } from "./hooks/useCanvasHistory";
import { HexagonCanvas } from "./HexagonCanvas";
import { CanvasToolbar } from "./CanvasToolbar";
import { NodeEditorDialog } from "./NodeEditorDialog";
import type { WizardData } from "@hexagen/project-configuration";
import type { Result } from "@hexagen/shared";

interface GraphCanvasWrapperProps {
  projectId?: string;
  wizardData?: WizardData;
}

/**
 * Inner component that has access to React Flow instance for viewport control
 */
function GraphCanvasInner({ projectId, wizardData }: GraphCanvasWrapperProps) {
  const state = useCanvasState(projectId, wizardData);
  const { undo, redo, canUndo, canRedo } = useCanvasHistory();
  const reactFlowInstance = useReactFlow();
  const [exportHandler, setExportHandler] = useState<
    (() => Promise<Result<Blob, Error>>) | null
  >(null);

  // Track if we should fit view after next render
  const shouldFitViewRef = useRef(false);

  const handleExportClick = useCallback(
    (handler: () => Promise<Result<Blob, Error>>) => {
      setExportHandler(() => handler);
    },
    [],
  );

  const handleExport = useCallback(async () => {
    if (!exportHandler) {
      alert("Export is not available in this context");
      return;
    }

    const result = await exportHandler();
    if (!result.success) {
      alert(`Export failed: ${result.error.message}`);
      return;
    }

    const blob = result.value;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `architecture-${new Date().toISOString()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportHandler]);

  /**
   * Fit view with smooth animation
   */
  const fitView = useCallback(() => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({
        padding: 0.2,
        duration: 800,
      });
    }
  }, [reactFlowInstance]);

  /**
   * Handle undo with viewport orchestration
   */
  const handleUndo = useCallback(() => {
    undo();
    shouldFitViewRef.current = true;
  }, [undo]);

  /**
   * Handle redo with viewport orchestration
   */
  const handleRedo = useCallback(() => {
    redo();
    shouldFitViewRef.current = true;
  }, [redo]);

  /**
   * Handle clean-up (recalculate layout)
   * Clears localStorage positions first to force fresh ELK layout calculation
   */
  const handleCleanup = useCallback(async () => {
    if ("error" in state) return;

    // Clear localStorage positions to force fresh layout calculation
    await state.clearCanvasLayout();
    shouldFitViewRef.current = true;
  }, [state]);

  /**
   * Fit view after state changes if requested
   */
  useEffect(() => {
    if (
      shouldFitViewRef.current &&
      !("error" in state) &&
      !state.isLayoutCalculating
    ) {
      // Small delay to ensure nodes are rendered
      const timer = setTimeout(() => {
        fitView();
        shouldFitViewRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [state, fitView]);

  if ("error" in state) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-96">
        <div className="text-destructive">
          Failed to load graph: {state.error.message}
        </div>
      </div>
    );
  }

  if (state.nodes.length === 0 && !state.isLayoutCalculating) {
    return (
      <div className="flex items-center justify-center w-full h-full min-h-96 bg-muted/20">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-medium mb-2">No Architecture Data</p>
          <p className="text-sm">
            Complete the wizard to visualize your project structure
          </p>
        </div>
      </div>
    );
  }

  const selectedNode = state.selectedNodeId
    ? state.nodes.find((n) => n.id === state.selectedNodeId)
    : undefined;

  return (
    <div className="w-full h-full min-h-96 flex flex-col">
      <CanvasToolbar
        onAddNode={state.onAddNode}
        onExport={handleExport}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCleanup={handleCleanup}
        canUndo={canUndo}
        canRedo={canRedo}
        isCalculating={state.isLayoutCalculating}
      />
      <div className="flex-1 relative">
        <HexagonCanvas
          nodes={state.nodes}
          edges={state.edges}
          onNodeDragStop={state.onNodeDragStop}
          onNodeDoubleClick={state.onNodeDoubleClick}
          onExportClick={handleExportClick}
        />
        <NodeEditorDialog
          key={selectedNode?.id}
          isOpen={!!selectedNode}
          node={selectedNode}
          onClose={state.onCloseEditor}
          onUpdateNode={state.onUpdateNode}
        />
      </div>
    </div>
  );
}

/**
 * Main wrapper component with React Flow Provider
 */
export function GraphCanvasWrapper({
  projectId,
  wizardData,
}: GraphCanvasWrapperProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner projectId={projectId} wizardData={wizardData} />
    </ReactFlowProvider>
  );
}

// Made with Bob
