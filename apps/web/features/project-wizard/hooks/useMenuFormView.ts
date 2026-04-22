"use client";

import { useCallback, useState } from "react";

export type MenuFormView = "menu" | "form";

export interface UseMenuFormViewReturn<IdT> {
  /** Whether the list view ("menu") or detail view ("form") is active. */
  view: MenuFormView;
  /** Id of the item the user has requested to delete (overlay-confirm). */
  confirmDeleteId: IdT | null;

  /** Switch to the list view. */
  openMenu: () => void;
  /** Switch to the detail view. */
  openForm: () => void;
  /** Show the inline "Delete?" confirmation for this item. */
  requestDelete: (id: IdT) => void;
  /** Dismiss the inline delete confirmation. */
  cancelDelete: () => void;
}

/**
 * Shared state machine for wizard steps that alternate between a list
 * view and a single-item form view, with an inline delete-confirm
 * overlay on each list item.
 *
 * Used by BoundedContextStep and PeerContextMappingStep — both have
 * the same interaction pattern (list of entities with pick-to-edit +
 * delete-with-confirm). Abstracting it here keeps the two steps'
 * state shapes identical and enables future shared list primitives.
 *
 * @typeParam IdT  Type of the item identifier (string for both current
 *                 consumers; kept generic for future use cases).
 */
export function useMenuFormView<IdT = string>(): UseMenuFormViewReturn<IdT> {
  const [view, setView] = useState<MenuFormView>("menu");
  const [confirmDeleteId, setConfirmDeleteId] = useState<IdT | null>(null);

  const openMenu = useCallback(() => {
    setView("menu");
    setConfirmDeleteId(null);
  }, []);

  const openForm = useCallback(() => {
    setView("form");
    setConfirmDeleteId(null);
  }, []);

  const requestDelete = useCallback((id: IdT) => {
    setConfirmDeleteId(id);
  }, []);

  const cancelDelete = useCallback(() => {
    setConfirmDeleteId(null);
  }, []);

  return {
    view,
    confirmDeleteId,
    openMenu,
    openForm,
    requestDelete,
    cancelDelete,
  };
}
