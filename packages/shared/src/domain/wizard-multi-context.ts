import { BoundedContext } from "./wizard-data.js";

/**
 * Derive the active bounded context from the collection.
 * Pure domain function – no React.
 */
export function deriveActiveContext(
  contexts: BoundedContext[],
  activeId: string,
): BoundedContext | null {
  return contexts.find((c) => c.id === activeId) || null;
}

/**
 * Callback signature for updating a context.
 * The implementation merges the partial updates into the target context.
 */
export type ContextUpdateCallback = (
  contextId: string,
  updates: Partial<BoundedContext>,
) => void;
