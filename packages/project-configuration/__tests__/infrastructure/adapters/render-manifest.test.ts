import { describe, it } from "vitest";
import assert from "node:assert";
import { FakeRenderManifestPort } from "../../doubles/ports/render-manifest.fake";

describe("render-manifest", () => {
  it("returns the default rendered manifest when no behavior is set", async () => {
    const defaultFake = new FakeRenderManifestPort();
    const defaultResult = await defaultFake.execute({ bounded_contexts: [] });
    assert.deepStrictEqual(
      defaultResult,
      {
        yaml: "system: test-system\nscope: test\narchitecture: hexagonal\n",
        diagnostics: [],
        token: "test-token",
      },
      "the default fake should return its canned rendered manifest",
    );
  });

  it("applies a custom behavior when one is set", async () => {
    const customFake = new FakeRenderManifestPort();
    customFake.setBehavior(async () => ({
      yaml: "custom: true\n",
      diagnostics: [],
      token: "custom-token",
    }));
    const customResult = await customFake.execute({ bounded_contexts: [] });
    assert.deepStrictEqual(
      customResult,
      { yaml: "custom: true\n", diagnostics: [], token: "custom-token" },
      "a custom behavior should override the default rendered manifest",
    );
  });
});
