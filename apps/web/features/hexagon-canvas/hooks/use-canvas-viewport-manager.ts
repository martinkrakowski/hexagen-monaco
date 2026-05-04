"use client";

import { useCallback, useRef, useEffect } from "react";
import { useReactFlow } from "@xyflow/react";

export function useCanvasViewportManager({
  state,
}: {
  state: ReturnType<typeof import("./useCanvasState").useCanvasState>;
}): {
  fitView: () => void;
  shouldFitViewRef: React.MutableRefObject<boolean>;
} {
  const reactFlowInstance = useReactFlow();
  const shouldFitViewRef = useRef(false);

  const fitView = useCallback(() => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({
        padding: 0.2,
        duration: 800,
      });
    }
  }, [reactFlowInstance]);

  useEffect(() => {
    if (
      shouldFitViewRef.current &&
      !("error" in state) &&
      state.isLayoutCalculating === false
    ) {
      const timer = setTimeout(() => {
        fitView();
        shouldFitViewRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [state, fitView]);

  return {
    fitView,
    shouldFitViewRef,
  };
}
