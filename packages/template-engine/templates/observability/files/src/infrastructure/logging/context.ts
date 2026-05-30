import { AsyncLocalStorage } from "node:async_hooks";

/** Ambient per-request context, carried through the async call chain. */
export interface RequestContext {
  requestId: string;
  userId?: string;
  sessionId?: string;
  startedAt: number;
}

const store = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `ctx` available to every async descendant via getRequestContext(). */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return store.run(ctx, fn);
}

/** The current request context, or undefined outside a request scope. */
export function getRequestContext(): RequestContext | undefined {
  return store.getStore();
}
