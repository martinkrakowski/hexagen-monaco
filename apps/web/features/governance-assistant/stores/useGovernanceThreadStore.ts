/**
 * Zustand store for governance conversation threads.
 *
 * Hoists thread state out of component-local hooks to prevent
 * state loss when accordions collapse/expand or when switching
 * between violations and Q&A views.
 *
 * Key pattern:
 * - Step questions: `step-${stepId}-${questionId}`
 * - Violation questions: `violation-${violationId}-${questionId}`
 * - Suggestion questions: `suggestion-${suggestionId}-${questionId}`
 * - Violations overview: `violations-${stepId}`
 *
 * Thread state persists in IndexedDB via the existing
 * ChatPersistencePort adapter.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { GovernanceEntry } from "@hexagen/local-llm";

interface GovernanceThreadState {
  /**
   * Map of contextKey -> conversation thread.
   * Threads survive component unmount/remount.
   */
  threads: Map<string, GovernanceEntry[]>;

  /**
   * Set the thread for a given context key.
   */
  setThread: (contextKey: string, thread: GovernanceEntry[]) => void;

  /**
   * Get the thread for a given context key.
   * Returns empty array if not found.
   */
  getThread: (contextKey: string) => GovernanceEntry[];

  /**
   * Clear the thread for a given context key.
   */
  clearThread: (contextKey: string) => void;

  /**
   * Clear all threads (used on project discard).
   */
  clearAllThreads: () => void;

  /**
   * Update a specific entry in a thread (for regeneration).
   */
  updateEntry: (
    contextKey: string,
    entryId: string,
    updater: (entry: GovernanceEntry) => void,
  ) => void;

  /**
   * Append an entry to a thread.
   */
  appendEntry: (contextKey: string, entry: GovernanceEntry) => void;
}

export const useGovernanceThreadStore = create<GovernanceThreadState>()(
  immer((set, get) => ({
    threads: new Map(),

    setThread: (contextKey, thread) =>
      set((state) => {
        state.threads.set(contextKey, thread);
      }),

    getThread: (contextKey) => {
      const thread = get().threads.get(contextKey);
      return thread ?? [];
    },

    clearThread: (contextKey) =>
      set((state) => {
        state.threads.delete(contextKey);
      }),

    clearAllThreads: () =>
      set((state) => {
        state.threads.clear();
      }),

    updateEntry: (contextKey, entryId, updater) =>
      set((state) => {
        const thread = state.threads.get(contextKey);
        if (!thread) return;

        const entryIndex = thread.findIndex((e) => e.id === entryId);
        if (entryIndex === -1) return;

        updater(thread[entryIndex]);
      }),

    appendEntry: (contextKey, entry) =>
      set((state) => {
        const thread = state.threads.get(contextKey);
        if (thread) {
          thread.push(entry);
        } else {
          state.threads.set(contextKey, [entry]);
        }
      }),
  })),
);

// Made with Bob
