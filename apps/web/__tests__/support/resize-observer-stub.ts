import { afterAll, beforeAll } from "vitest";

/**
 * Shared no-op ResizeObserver stub for suites that render the workbench's
 * desktop layout: react-resizable-panels instantiates a ResizeObserver on
 * mount, and jsdom doesn't ship one.
 *
 * Call ONCE at module scope of a suite — the helper registers its own
 * beforeAll/afterAll. Teardown is restore-or-delete: whatever global existed
 * before the suite is restored; if none existed the global is deleted, so the
 * stub never leaks into sibling suites sharing the worker (some of which rely
 * on ResizeObserver being absent).
 *
 * Placement is deliberate:
 * - under apps/web/__tests__/support/, OUTSIDE features/ — the
 *   no-feature-slice-imports rule (eslint.config.js) would flag a helper that
 *   lived inside one slice and was imported by suites in another;
 * - not matched by the vitest include glob (it is not a *.test.* file);
 * - explicitly NOT vitest.setup.ts — a global stub was proposed and REJECTED
 *   in PR #421's review adjudication: only suites that actually render the
 *   desktop panels should see a ResizeObserver. Do not move it there.
 */
export function installResizeObserverStub(): void {
  const hadResizeObserver = "ResizeObserver" in globalThis;
  const originalResizeObserver = globalThis.ResizeObserver;
  beforeAll(() => {
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
  });
  afterAll(() => {
    if (hadResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });
}
