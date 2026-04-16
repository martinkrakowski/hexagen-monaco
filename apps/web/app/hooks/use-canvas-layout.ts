"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { PersistedCanvasLayout, NodePosition } from "@hexagen/shared";
import { getCanvasLayoutPersistence, getWizardPersistence } from "@/lib/wire";

const DEBOUNCE_MS = 500;

export interface CanvasLayoutState {
  nodePositions: Record<string, NodePosition>;
}

export function useCanvasLayout() {
  const [nodePositions, setNodePositions] = useState<
    Record<string, NodePosition>
  >({});
  const [isLoaded, setIsLoaded] = useState(false);
  const pendingWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const loadLayout = useCallback(async (sessionId: string) => {
    const persistence = getCanvasLayoutPersistence();
    const result = await persistence.loadCanvasLayout(sessionId);
    if (!result.success || result.value === null) {
      setNodePositions({});
      setIsLoaded(true);
      return;
    }

    setNodePositions(result.value.nodePositions);
    setIsLoaded(true);
  }, []);

  const flushToStorage = useCallback(
    async (sessionId: string, positions: Record<string, NodePosition>) => {
      const layout: PersistedCanvasLayout = {
        schemaVersion: 1,
        sessionId,
        updatedAt: Date.now(),
        nodePositions: positions,
      };
      const persistence = getCanvasLayoutPersistence();
      const result = await persistence.saveCanvasLayout(sessionId, layout);
      if (!result.success) {
        getCanvasLayoutPersistence();
      }
    },
    [],
  );

  const scheduleWrite = useCallback(
    (sessionId: string, positions: Record<string, NodePosition>) => {
      if (pendingWriteRef.current) {
        clearTimeout(pendingWriteRef.current);
      }
      pendingWriteRef.current = setTimeout(() => {
        flushToStorage(sessionId, positions);
        pendingWriteRef.current = null;
      }, DEBOUNCE_MS);
    },
    [flushToStorage],
  );

  const initializeFromDraft = useCallback(async () => {
    const wizardPersistence = getWizardPersistence();
    const draftResult = await wizardPersistence.loadDraft();
    if (
      draftResult.success &&
      draftResult.value &&
      draftResult.value.sessionId
    ) {
      sessionIdRef.current = draftResult.value.sessionId;
      await loadLayout(draftResult.value.sessionId);
    } else {
      setIsLoaded(true);
    }
  }, [loadLayout]);

  useEffect(() => {
    initializeFromDraft();
    return () => {
      if (pendingWriteRef.current) {
        clearTimeout(pendingWriteRef.current);
      }
    };
  }, [initializeFromDraft]);

  const setSessionId = useCallback(
    async (sessionId: string) => {
      if (pendingWriteRef.current) {
        clearTimeout(pendingWriteRef.current);
        pendingWriteRef.current = null;
      }
      sessionIdRef.current = sessionId;
      await loadLayout(sessionId);
    },
    [loadLayout],
  );

  const clearSession = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    if (pendingWriteRef.current) {
      clearTimeout(pendingWriteRef.current);
      pendingWriteRef.current = null;
    }

    const persistence = getCanvasLayoutPersistence();
    await persistence.clearCanvasLayout(sessionId);
    sessionIdRef.current = null;
    setNodePositions({});
    setIsLoaded(true);
  }, []);

  const updateNodePosition = useCallback(
    (nodeId: string, position: NodePosition) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      setNodePositions((prev) => {
        const next = { ...prev, [nodeId]: position };
        scheduleWrite(sessionId, next);
        return next;
      });
    },
    [scheduleWrite],
  );

  const clearLayout = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    if (pendingWriteRef.current) {
      clearTimeout(pendingWriteRef.current);
      pendingWriteRef.current = null;
    }

    const persistence = getCanvasLayoutPersistence();
    await persistence.clearCanvasLayout(sessionId);
    setNodePositions({});
  }, []);

  return {
    nodePositions,
    isLoaded,
    setSessionId,
    clearSession,
    updateNodePosition,
    clearLayout,
  };
}
