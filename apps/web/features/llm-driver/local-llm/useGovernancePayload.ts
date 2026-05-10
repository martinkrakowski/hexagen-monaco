"use client";

import { useEffect, useRef, useState, useCallback } from "react";

import {
  type EditorState as EditorContextState,
  type GovernancePayload,
} from "@hexagen/prompt-compiler";
import { useCodeChangeSubscription } from "@/hooks/useSharedState";

/**
 * Initial editor snapshot used before any code-change event fires.
 * filename/language defaults reflect the primary artifact (manifest.yaml);
 * actual lineEnd is recomputed by chunkEditorBuffer at send time.
 */
const INITIAL_EDITOR_STATE: EditorContextState = {
  filename: "manifest.yaml",
  language: "yaml",
  content: "",
  lineStart: 1,
  lineEnd: 1,
};

export interface UseGovernancePayloadReturn {
  /** Optional error message when fetching fails */
  error?: string | null;
  /** Function to retry fetching the governance payload */
  retry?: () => void;
  governancePayload: GovernancePayload | null;
  /**
   * Ref holding the latest editor snapshot. Readers access via
   * `.current` at send time so content reads always see the most
   * recent Monaco buffer without triggering a re-render on each
   * keystroke. Updated via useCodeChangeSubscription.
   */
  editorStateRef: React.MutableRefObject<EditorContextState>;
}

/**
 * Owns the governance context fetched from /api/llm/context and the
 * editor buffer snapshot used when constructing grounded prompts.
 *
 * The editor snapshot lives in a ref (not state) because we don't
 * want a re-render on every keystroke — readers only need the latest
 * value at prompt-construction time.
 */
export function useGovernancePayload(): UseGovernancePayloadReturn {
  const [governancePayload, setGovernancePayload] =
    useState<GovernancePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editorStateRef = useRef<EditorContextState>(INITIAL_EDITOR_STATE);
  useCodeChangeSubscription((event) => {
    editorStateRef.current = {
      ...editorStateRef.current,
      content: event.content,
    };
  });

  // Fetch governance payload – exposed as a retryable callback
  const fetchGovernance = useCallback(
    async (force = false) => {
      if (governancePayload && !force) return;
      try {
        const res = await fetch("/api/llm/context");
        if (res.ok) {
          const payload = await res.json();
          setGovernancePayload(payload);
          setError(null);
        } else {
          const errMsg = `Unexpected response ${res.status}`;
          setError(errMsg);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    },
    [governancePayload],
  );

  // Run once on mount
  useEffect(() => {
    fetchGovernance();
  }, [fetchGovernance]);

  const retry = useCallback(() => fetchGovernance(true), [fetchGovernance]);

  return { governancePayload, editorStateRef, error, retry };
}
