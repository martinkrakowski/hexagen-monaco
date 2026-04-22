"use client";

import { useEffect, useRef, useState } from "react";

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

  const editorStateRef = useRef<EditorContextState>(INITIAL_EDITOR_STATE);
  useCodeChangeSubscription((event) => {
    editorStateRef.current = {
      ...editorStateRef.current,
      content: event.content,
    };
  });

  useEffect(() => {
    if (governancePayload) return;

    const fetchGovernance = async () => {
      try {
        const res = await fetch("/api/llm/context");
        if (res.ok) {
          const payload = await res.json();
          setGovernancePayload(payload);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Failed to fetch governance context:", err);
      }
    };

    fetchGovernance();
  }, [governancePayload]);

  return { governancePayload, editorStateRef };
}
