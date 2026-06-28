"use client";

import { create } from "zustand";
import type { ManifestViewData } from "@hexagen/manifest-generation";

/**
 * One bounded-context card as rendered by ContextMapView. Derived from
 * ManifestViewData (the package's barrel export) rather than importing
 * BoundedContextView directly, so this stays correct if the model moves.
 */
export type ContextView = ManifestViewData["contexts"][number];

interface ContextChatPanelState {
  /** The context the AI drawer is (or was last) focused on. */
  selectedContext: ContextView | null;
  /** Whether the drawer is visible. */
  isOpen: boolean;
  /** Focus a context and open the drawer (clicking a context card). */
  open: (ctx: ContextView) => void;
  /** Hide the drawer. `selectedContext` is kept so re-opening the same
   *  context preserves its conversation; opening a different context
   *  swaps `selectedContext` (a new reference) and re-seeds the chat. */
  close: () => void;
}

/**
 * UI state shared between the (leaf) ContextMapView cards and the
 * ContextGovernanceChatDrawer mounted on the accept page. Using a small store
 * avoids threading an `onSelectContext` prop through the shared ManifestPreview.
 * Mirrors the existing `store/usePendingManifest.ts` pattern.
 */
export const useContextChatPanel = create<ContextChatPanelState>((set) => ({
  selectedContext: null,
  isOpen: false,
  open: (ctx) => set({ selectedContext: ctx, isOpen: true }),
  close: () => set({ isOpen: false }),
}));
