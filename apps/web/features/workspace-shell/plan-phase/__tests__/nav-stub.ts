import { useSyncExternalStore } from "react";

/**
 * STATEFUL next/navigation stub for suites that exercise the `?layer=` URL
 * selection (Plan Workbench PR B): `router.replace`/`push` really rewrite the
 * tracked query string and re-render `useSearchParams` subscribers (via
 * useSyncExternalStore), mirroring the app-router contract that the inert
 * global stub in vitest.setup.ts deliberately omits. Without it a sessions-row
 * click — which only calls router.replace — would never re-render the view.
 *
 * Usage (the factory must be referenced lazily; vi.mock is hoisted):
 *
 *   vi.mock("next/navigation", async () =>
 *     (await import("./nav-stub")).statefulNavigationMock(),
 *   );
 *
 * and `navState.reset(...)` in beforeEach (AFTER cleanup()).
 */

type NavListener = () => void;

const listeners = new Set<NavListener>();
let search = "";

function emit() {
  for (const listener of [...listeners]) listener();
}

function applyUrl(url: string) {
  const queryStart = url.indexOf("?");
  search = queryStart === -1 ? "" : url.slice(queryStart + 1);
  emit();
}

function subscribe(listener: NavListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => search;

export const navState = {
  /** Every URL passed to router.replace, in order. */
  replaceCalls: [] as string[],
  /** Every URL passed to router.push — the deep-link suite pins this EMPTY
   * (selection must never spray history entries). */
  pushCalls: [] as string[],
  /** The current query string (no leading "?"). */
  get search() {
    return search;
  },
  /** Reset call logs and seed the query string (deep-link setup). */
  reset(initialSearch = "") {
    search = initialSearch;
    this.replaceCalls = [];
    this.pushCalls = [];
  },
};

export function statefulNavigationMock() {
  return {
    useRouter: () => ({
      replace: (url: string) => {
        navState.replaceCalls.push(url);
        applyUrl(url);
      },
      push: (url: string) => {
        navState.pushCalls.push(url);
        applyUrl(url);
      },
      prefetch: () => {},
      back: () => {},
      forward: () => {},
      refresh: () => {},
    }),
    usePathname: () => "/wizard/1",
    useSearchParams: () => {
      // A hook by contract: called from the component under test's render.
      const snapshot = useSyncExternalStore(
        subscribe,
        getSnapshot,
        getSnapshot,
      );
      return new URLSearchParams(snapshot);
    },
    useParams: () => ({ step: "1" }),
  };
}
