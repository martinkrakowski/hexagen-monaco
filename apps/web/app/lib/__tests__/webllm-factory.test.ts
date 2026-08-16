/**
 * `createWebLLMAdapter` is the composition root's boundary conversion for a
 * model id that arrives in an HTTP body (`/api/manifest/generate/local`).
 *
 * `DomainModelId` is a runtime string ENUM, so the cast the route used to do
 * checked nothing: any non-empty string became the adapter's `defaultModelId`
 * and `initialize()` then failed with `Unknown model ID: ...` instead of
 * applying the adapter's own default. The package's own `isDomainModelId` guard
 * is what closes that, and it is taken off the SAME dynamic import so the WebLLM
 * bundle stays out of every other server path's module graph.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const localLlm = vi.hoisted(() => ({
  constructed: [] as Array<{ defaultModelId?: unknown }>,
}));

vi.mock("@hexagen/local-llm", () => ({
  WebLLMAdapter: class {
    constructor(config: { defaultModelId?: unknown }) {
      localLlm.constructed.push(config);
    }
  },
  isDomainModelId: (value: unknown) =>
    typeof value === "string" &&
    ["qwen-coder-3b", "qwen-coder-1.5b"].includes(value),
}));

beforeEach(() => {
  localLlm.constructed.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetModules();
});

test.each([
  ["a recognised id is passed through", "qwen-coder-3b", "qwen-coder-3b"],
  ["an unrecognised id becomes undefined", "gpt-4o", undefined],
  ["an empty string becomes undefined", "", undefined],
  ["an absent id stays undefined", undefined, undefined],
])("%s", async (_label, input, expected) => {
  const { createWebLLMAdapter } = await import("../wire.server");

  const adapter = await createWebLLMAdapter(input as string | undefined);

  expect(adapter).not.toBeNull();
  expect(localLlm.constructed).toHaveLength(1);
  expect(localLlm.constructed[0]?.defaultModelId).toBe(expected);
});
