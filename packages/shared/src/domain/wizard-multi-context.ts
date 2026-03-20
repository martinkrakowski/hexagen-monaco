import { BoundedContext, ExternalContext } from "./wizard-data.js";

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
 * Can be used for both BoundedContext and ExternalContext.
 */
type ContextUpdate = Partial<BoundedContext> | Partial<ExternalContext>;
export type ContextUpdateCallback = (
  contextId: string,
  updates: ContextUpdate,
) => void;
