import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createHardwareProfile } from "@hexagen/local-llm/client";
import type { HardwareProfile } from "@hexagen/local-llm/client";
import type { HardwareProfiler } from "../src/ui/useHardwareDetection.js";

/**
 * `useHardwareDetection` is the one piece of acquisition logic in this package
 * (everything else is presentation — see HEX-022 / #519): it reads a cached
 * profile, falls back to a real detection pass, writes the result back to the
 * session cache and maps failures to a message.
 *
 * The SUBJECT is the hook. What is supplied is the profiler behind the seam the
 * module publishes for exactly that purpose — `setHardwareProfiler`, typed
 * `HardwareProfiler` — so the injected object is the port implementation, not a
 * stand-in for the code under test. `sessionStorage` is likewise supplied
 * rather than assumed: Node 24+ defines a global `sessionStorage` that throws
 * without `--localstorage-file`, and Vitest's jsdom environment skips copying
 * any window key `globalThis` already owns, so jsdom's store is present on
 * CI's Node 22.7 and shadowed on a newer local Node. The hook swallows storage
 * errors by design, so left alone that difference would silently change which
 * branch these tests take.
 *
 * These suites run in THIS workspace. `apps/web` cannot mount this hook: it
 * resolves React 19.2.4 while this package resolves its own 19.2.5, so a mount
 * from there throws `Invalid hook call` (issue #521) — which is why the web app
 * mocks `@hexagen/model-settings` wherever it appears.
 */

/**
 * The catalog's own factory validates its inputs and returns a `Result`, so a
 * fixture that failed validation would be caught here rather than silently
 * becoming a wrapper object the hook then reports as a "profile".
 */
function profileFixture(
  ...args: Parameters<typeof createHardwareProfile>
): HardwareProfile {
  const result = createHardwareProfile(...args);
  assert.ok(result.success, "fixture must be a valid HardwareProfile");
  return result.value;
}

const PROFILE = profileFixture(
  8,
  16_384,
  true,
  "apple",
  "Apple GPU",
  4_096,
  "desktop",
);

const OTHER_PROFILE = profileFixture(
  2,
  2_048,
  false,
  null,
  null,
  null,
  "mobile",
);

const CACHE_KEY = "hexagen:local-llm:hardware-profile";

/** An in-memory `Storage` for the session cache the hook reads and writes. */
function createSessionStore(seed: Record<string, string> = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    getItem: (key: string): string | null => entries.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      entries.set(key, value);
    },
    removeItem: (key: string): void => {
      entries.delete(key);
    },
    clear: (): void => entries.clear(),
    get length(): number {
      return entries.size;
    },
    key: (index: number): string | null => [...entries.keys()][index] ?? null,
  };
}

/** A `HardwareProfiler` that succeeds, counting how often it was consulted. */
function succeedingProfiler(profile: HardwareProfile) {
  let calls = 0;
  const profiler: HardwareProfiler = {
    async profile() {
      calls += 1;
      return { success: true, value: profile };
    },
  };
  return { profiler, calls: () => calls };
}

/** A `HardwareProfiler` that reports a domain-level failure. */
const failingProfiler: HardwareProfiler = {
  async profile() {
    return { success: false, error: new Error("WebGPU unavailable") };
  },
};

/** A `HardwareProfiler` that throws instead of returning a failure result. */
const throwingProfiler: HardwareProfiler = {
  async profile() {
    throw new Error("adapter exploded");
  },
};

/**
 * The hook's snapshot cache and profiler registration are module-scope, so each
 * test loads a fresh copy of the module rather than inheriting the previous
 * test's state.
 */
async function loadHook() {
  vi.resetModules();
  return import("../src/ui/useHardwareDetection.js");
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", createSessionStore());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useHardwareDetection — detection", () => {
  it("reports the profile the registered profiler returned", async () => {
    const { useHardwareDetection, setHardwareProfiler } = await loadHook();
    const { profiler } = succeedingProfiler(PROFILE);
    setHardwareProfiler(() => profiler);

    const { result } = renderHook(() => useHardwareDetection());

    await waitFor(() => assert.equal(result.current.isDetecting, false));
    assert.deepEqual(result.current.profile, PROFILE);
    assert.equal(result.current.error, null);
  });

  it("starts in the detecting state rather than claiming no hardware", async () => {
    const { useHardwareDetection, setHardwareProfiler } = await loadHook();
    const { profiler } = succeedingProfiler(PROFILE);
    setHardwareProfiler(() => profiler);

    const { result } = renderHook(() => useHardwareDetection());

    assert.equal(result.current.isDetecting, true);
    assert.equal(result.current.profile, null);
    await waitFor(() => assert.equal(result.current.isDetecting, false));
  });

  it("writes the detected profile to the session cache", async () => {
    const { useHardwareDetection, setHardwareProfiler } = await loadHook();
    const { profiler } = succeedingProfiler(PROFILE);
    setHardwareProfiler(() => profiler);

    const { result } = renderHook(() => useHardwareDetection());
    await waitFor(() => assert.equal(result.current.isDetecting, false));

    assert.deepEqual(
      JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null"),
      PROFILE,
    );
  });
});

describe("useHardwareDetection — cache", () => {
  it("serves a cached profile WITHOUT consulting the profiler", async () => {
    vi.stubGlobal(
      "sessionStorage",
      createSessionStore({ [CACHE_KEY]: JSON.stringify(OTHER_PROFILE) }),
    );
    const { useHardwareDetection, setHardwareProfiler } = await loadHook();
    const { profiler, calls } = succeedingProfiler(PROFILE);
    setHardwareProfiler(() => profiler);

    const { result } = renderHook(() => useHardwareDetection());

    await waitFor(() => assert.equal(result.current.isDetecting, false));
    assert.deepEqual(result.current.profile, OTHER_PROFILE);
    assert.equal(calls(), 0);
  });

  it("falls through to a fresh detection when the cache entry is corrupt", async () => {
    vi.stubGlobal(
      "sessionStorage",
      createSessionStore({ [CACHE_KEY]: "{not json" }),
    );
    const { useHardwareDetection, setHardwareProfiler } = await loadHook();
    const { profiler, calls } = succeedingProfiler(PROFILE);
    setHardwareProfiler(() => profiler);

    const { result } = renderHook(() => useHardwareDetection());

    await waitFor(() => assert.equal(result.current.isDetecting, false));
    assert.deepEqual(result.current.profile, PROFILE);
    assert.equal(calls(), 1);
    assert.equal(result.current.error, null);
  });

  it("still reports the profile when the cache write fails", async () => {
    const store = createSessionStore();
    vi.stubGlobal("sessionStorage", {
      ...store,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    const { useHardwareDetection, setHardwareProfiler } = await loadHook();
    const { profiler } = succeedingProfiler(PROFILE);
    setHardwareProfiler(() => profiler);

    const { result } = renderHook(() => useHardwareDetection());

    await waitFor(() => assert.equal(result.current.isDetecting, false));
    assert.deepEqual(result.current.profile, PROFILE);
    assert.equal(result.current.error, null);
  });
});

describe("useHardwareDetection — failure paths", () => {
  it("names the missing registration when no profiler was configured", async () => {
    const { useHardwareDetection } = await loadHook();

    const { result } = renderHook(() => useHardwareDetection());

    await waitFor(() => assert.equal(result.current.isDetecting, false));
    assert.equal(
      result.current.error,
      "Hardware profiler not configured. Call setHardwareProfiler first.",
    );
    assert.equal(result.current.profile, null);
  });

  it("surfaces a failed profile result as its error message", async () => {
    const { useHardwareDetection, setHardwareProfiler } = await loadHook();
    setHardwareProfiler(() => failingProfiler);

    const { result } = renderHook(() => useHardwareDetection());

    await waitFor(() => assert.equal(result.current.isDetecting, false));
    assert.equal(result.current.error, "WebGPU unavailable");
    assert.equal(result.current.profile, null);
  });

  it("surfaces a thrown profiler as its error message rather than hanging", async () => {
    const { useHardwareDetection, setHardwareProfiler } = await loadHook();
    setHardwareProfiler(() => throwingProfiler);

    const { result } = renderHook(() => useHardwareDetection());

    await waitFor(() => assert.equal(result.current.isDetecting, false));
    assert.equal(result.current.error, "adapter exploded");
    assert.equal(result.current.profile, null);
  });

  it("leaves detection finished on every failure path — the UI never spins forever", async () => {
    const { useHardwareDetection, setHardwareProfiler } = await loadHook();
    setHardwareProfiler(() => failingProfiler);

    const { result } = renderHook(() => useHardwareDetection());

    await waitFor(() => assert.equal(result.current.isDetecting, false));
    assert.notEqual(result.current.error, null);
  });
});
