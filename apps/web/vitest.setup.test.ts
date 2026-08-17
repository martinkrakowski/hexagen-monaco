/**
 * Contract for `vitest.setup.ts`'s storage globals.
 *
 * The DEFECT this pins: the setup installed `localStorage`/`sessionStorage` with
 * `vi.stubGlobal`, which files them in Vitest's global-stub registry. Any suite
 * calling `vi.unstubAllGlobals()` — the ordinary way to drop a per-test `fetch`
 * stub — therefore also handed both storages back to the host's built-in getter,
 * which under Vitest throws `SecurityError: Cannot initialize local storage
 * without a --localstorage-file path`. The setup's own `afterEach` then died, so
 * the failure surfaced inside shared infrastructure with no mention of the call
 * that caused it. `app/lib/fetch-json.test.ts` lost all 12 of its tests to this,
 * and three further suites carry hand-written comments talking their authors out
 * of `vi.unstubAllGlobals()`.
 *
 * These tests deliberately CALL `vi.unstubAllGlobals()` — the exact thing that
 * used to be forbidden — so a regression to `vi.stubGlobal` in the setup reddens
 * here, at a test that names the reason, rather than as a SecurityError five
 * frames deep in someone else's suite.
 */
import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
});

/** Reads the global without evaluating a (possibly throwing) accessor. */
function storageDescriptor(name: string): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(globalThis, name);
}

describe("vitest.setup.ts React act environment", () => {
  /**
   * The DEFECT this pins: nothing in the repo set `IS_REACT_ACT_ENVIRONMENT`, so
   * React 19 emitted "The current testing environment is not configured to
   * support act(...)" — 54 times in one CI run on `main`, from the two
   * governance-chat suites, which import `act` straight from "react".
   * @testing-library/react sets the flag only around its own operations and
   * restores it afterwards, so a direct `act()` call sits outside that window
   * and gets no guarantee that effects are flushed before the assertions run.
   * The suites passed either way, which is the problem: they stopped proving
   * what their names claim, and the warning taught readers to skim stderr.
   */
  it("declares the environment act-capable, so a direct React act() flushes", () => {
    assert.equal(
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT,
      true,
      "vitest.setup.ts must set IS_REACT_ACT_ENVIRONMENT = true; without it " +
        "React's act() warns and does not guarantee flushing for any suite that " +
        "imports act from 'react' rather than from @testing-library/react",
    );
  });
});

describe("vitest.setup.ts storage globals", () => {
  it("installs them as data properties, not through Vitest's stub registry", () => {
    for (const name of ["localStorage", "sessionStorage"]) {
      const descriptor = storageDescriptor(name);
      assert.ok(descriptor, `globalThis.${name} is not defined`);
      assert.ok(
        "value" in descriptor,
        `globalThis.${name} is an accessor — that is the host built-in, not the setup's in-memory storage`,
      );
      assert.equal(typeof (descriptor.value as Storage).clear, "function");
    }
  });

  it("survives vi.unstubAllGlobals() — the call that used to break the shared teardown", () => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem("survives", "yes");

    vi.unstubAllGlobals();

    // The suite's own stub is gone…
    assert.equal(globalThis.fetch, originalFetch);
    // …and the setup's storages are untouched. Reading them must not throw.
    assert.equal(localStorage.getItem("survives"), "yes");
    assert.doesNotThrow(() => sessionStorage.setItem("a", "b"));
  });

  it("restores the in-memory storage — never the throwing built-in — when a suite unstubs its OWN storage mock", () => {
    const suiteMock = {
      getItem: () => "from-the-suite-mock",
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;

    vi.stubGlobal("localStorage", suiteMock);
    assert.equal(localStorage.getItem("anything"), "from-the-suite-mock");

    vi.unstubAllGlobals();

    // Back to the setup's storage (empty, but readable), not Node's built-in.
    assert.equal(localStorage.getItem("anything"), null);
    assert.ok("value" in storageDescriptor("localStorage")!);
  });

  it("clears the storages between tests (no bleed from the cases above)", () => {
    assert.equal(localStorage.length, 0);
    assert.equal(sessionStorage.length, 0);
  });
});
