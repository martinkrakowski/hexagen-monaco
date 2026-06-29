"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContextView } from "./store/useContextChatPanel";
import { requestContextFixes, type ContextFix } from "./request-context-fixes";

type FixStatus = "idle" | "loading" | "ready" | "error";

interface UseContextFixesReturn {
  fixes: ContextFix[];
  status: FixStatus;
  appliedIds: ReadonlySet<string>;
  markApplied: (id: string) => void;
}

/**
 * Runs the structured fix-extraction once per reviewed context, after its review
 * has settled (so the buttons read as "based on that review"). Keyed to the
 * `selectedContext` reference — switching contexts resets and re-extracts; an
 * in-flight request is aborted on switch/unmount.
 */
export function useContextFixes(
  selectedContext: ContextView | null,
  reviewComplete: boolean,
): UseContextFixesReturn {
  const [fixes, setFixes] = useState<ContextFix[]>([]);
  const [status, setStatus] = useState<FixStatus>("idle");
  const [appliedIds, setAppliedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const requestedForRef = useRef<ContextView | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset whenever the focused context changes.
  useEffect(() => {
    requestedForRef.current = null;
    abortRef.current?.abort();
    setFixes([]);
    setStatus("idle");
    setAppliedIds(new Set());
  }, [selectedContext]);

  // Extract once the review for this context has settled.
  useEffect(() => {
    if (!selectedContext || !reviewComplete) return;
    if (requestedForRef.current === selectedContext) return;
    requestedForRef.current = selectedContext;

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    requestContextFixes(selectedContext, controller.signal)
      .then((fs) => {
        if (controller.signal.aborted) return;
        setFixes(fs);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [selectedContext, reviewComplete]);

  const markApplied = useCallback(
    (id: string) => setAppliedIds((s) => new Set(s).add(id)),
    [],
  );

  return { fixes, status, appliedIds, markApplied };
}
