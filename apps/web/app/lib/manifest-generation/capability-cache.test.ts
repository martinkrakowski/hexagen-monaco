import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

import { getCapabilities } from "./capability-cache";

const originalFetch = globalThis.fetch;

// These tests stub the fetch global; always restore so a leaked stub never
// bleeds into later tests. Restore ONLY fetch — "undo what this file stubbed"
// is what the hook means, and it stays correct however the shared setup grows.
// (`vi.unstubAllGlobals()` used to be actively unsafe here: vitest.setup.ts
// installed its `localStorage`/`sessionStorage` via `vi.stubGlobal`, so
// unstubbing re-exposed Node's throwing built-in getter and the shared
// afterEach died with `SecurityError: Cannot initialize local storage without a
// --localstorage-file path`. The setup now owns those globals outside Vitest's
// stub registry — see apps/web/vitest.setup.test.ts.)
//
// The module also keeps a process-wide 5-min TTL cache, but every test here
// fails the fetch (so nothing is cached) and asserts a fresh throw, so cache
// state does not interfere.
afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
});

describe("getCapabilities — Error.cause preservation (MOD-007)", () => {
  it("preserves the original network error as the thrown error's cause", async () => {
    const original = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(original));

    await assert.rejects(getCapabilities(), (err: unknown) => {
      assert.ok(err instanceof Error);
      // The wrapper message still carries a human-readable summary…
      assert.match(err.message, /Capability probe failed/);
      // …but the ROOT failure is preserved verbatim via Error.cause, not
      // stringified away. Same object identity, so stack/errno survive.
      assert.equal(err.cause, original);
      return true;
    });
  });

  it("preserves a non-ok HTTP failure (thrown inside the try) as the cause", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      }),
    );

    await assert.rejects(getCapabilities(), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Capability probe failed/);
      assert.ok(err.cause instanceof Error);
      assert.match(
        (err.cause as Error).message,
        /Failed to fetch capabilities: 503/,
      );
      return true;
    });
  });
});
