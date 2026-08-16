import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// The structured logger stays silent when NODE_ENV === "test" (Vitest sets this
// by default; assert it defensively so expected boot-migration failures don't
// spam CI logs — the same reason the old test-setup.ts set it).
(process.env as Record<string, string | undefined>).NODE_ENV ??= "test";

// The host's localStorage/sessionStorage throw a SecurityError under Vitest
// ("Cannot initialize local storage without a `--localstorage-file` path" — the
// Node >= 24 built-in, exposed as a *getter* on globalThis that refuses without
// the flag), so install a deterministic in-memory Storage (fresh per test file).
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
const STORAGE_GLOBALS = ["localStorage", "sessionStorage"] as const;

/**
 * Install the memory storages as plain data properties on `globalThis` —
 * deliberately NOT via `vi.stubGlobal`.
 *
 * `vi.stubGlobal` records the pre-stub descriptor in Vitest's global-stub
 * registry, and `vi.unstubAllGlobals()` restores every entry in that registry.
 * A setup-owned global therefore became a suite-revocable one: any suite that
 * called `vi.unstubAllGlobals()` to drop its own `fetch` stub also handed
 * `localStorage`/`sessionStorage` back to Node's throwing built-in getter, and
 * the shared `afterEach` below then died with the SecurityError above — five
 * frames away from the call that caused it. That is what
 * `app/lib/fetch-json.test.ts` hit (12 tests), and what three other suites had
 * to be talked out of in prose comments.
 *
 * `defineProperty` keeps these two out of the stub registry entirely, so
 * `vi.unstubAllGlobals()` restores exactly what the *suite* stubbed and nothing
 * else — which is what that API is supposed to mean. A suite that wants its own
 * storage mock can still `vi.stubGlobal("localStorage", …)`; unstubbing then
 * restores this in-memory storage rather than the built-in.
 *
 * `writable`/`configurable` so `vi.stubGlobal` can still overwrite and restore.
 */
function installMemoryStorages(): void {
  for (const name of STORAGE_GLOBALS) {
    Object.defineProperty(globalThis, name, {
      value: createMemoryStorage(),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}
installMemoryStorages();

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

/**
 * Read a storage global WITHOUT tripping the host's throwing getter.
 *
 * `globalThis.localStorage` is not a safe expression here: if the data property
 * installed above is ever gone, what is left is the built-in *accessor*, and
 * merely reading it throws. So inspect the descriptor instead and decide from
 * its shape:
 *
 * - data property → this setup's storage, or a suite's own mock. Clearable if
 *   it has a `clear()` (some suites install a minimal getItem/setItem/removeItem
 *   mock and manage their own reset — skip those, as before).
 * - accessor / absent → the setup's storage was torn out from under the suite.
 *   That is a broken test environment, not a storage to clear, and it is
 *   reported as such rather than clearing nothing and calling teardown done.
 */
function clearableStorage(
  name: (typeof STORAGE_GLOBALS)[number],
): Storage | null {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (!descriptor || !("value" in descriptor)) {
    throw new Error(
      `vitest.setup.ts: globalThis.${name} is no longer the in-memory storage this setup installed ` +
        `(the descriptor is ${descriptor ? "an accessor" : "absent"} — i.e. the host's built-in, whose getter throws under Vitest). ` +
        `Something in this test file removed it. The usual cause is deleting or bypassing installMemoryStorages(); ` +
        `note that vi.unstubAllGlobals() is NOT a cause — these globals are deliberately kept out of Vitest's stub registry.`,
    );
  }
  const value = descriptor.value as Storage | undefined;
  return typeof value?.clear === "function" ? value : null;
}

// Vitest does not auto-unmount React trees between tests, so @testing-library
// renders would otherwise accumulate in the shared jsdom document and bleed
// across tests in a file. Centralize the teardown that suites previously each
// declared themselves.
afterEach(() => {
  cleanup();
  // The in-memory storages live for the file's lifecycle; clear them between
  // tests so persisted keys can't bleed across tests in the same file.
  for (const name of STORAGE_GLOBALS) {
    clearableStorage(name)?.clear();
  }
});
