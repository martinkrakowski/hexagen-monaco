import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// The structured logger stays silent when NODE_ENV === "test" (Vitest sets this
// by default; assert it defensively so expected boot-migration failures don't
// spam CI logs — the same reason the old test-setup.ts set it).
(process.env as Record<string, string | undefined>).NODE_ENV ??= "test";

// jsdom's localStorage/sessionStorage throw a SecurityError under Vitest
// ("Cannot initialize local storage without a `--localstorage-file` path"), so
// install a deterministic in-memory Storage (fresh per test file).
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
}
vi.stubGlobal("localStorage", createMemoryStorage());
vi.stubGlobal("sessionStorage", createMemoryStorage());

// next/navigation's hooks throw "invariant expected app router to be mounted"
// outside Next's runtime. Components under test call useRouter() unconditionally
// (several also accept an injected-router prop that overrides it for assertions),
// so give every suite an inert app-router stub. A suite needing specific
// navigation behavior can still vi.mock("next/navigation") with its own factory.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Vitest does not auto-unmount React trees between tests, so @testing-library
// renders would otherwise accumulate in the shared jsdom document and bleed
// across tests in a file. Centralize the teardown that suites previously each
// declared themselves.
afterEach(() => {
  cleanup();
});
