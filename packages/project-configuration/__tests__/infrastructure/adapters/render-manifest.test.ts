import { describe, it } from "node:test";
import assert from "node:assert";
import { FakeRenderManifestPort } from "../../doubles/ports/render-manifest.fake";

describe("render-manifest", () => {
  it("returns the default rendered manifest when no behavior is set", async () => {
    const defaultFake = new FakeRenderManifestPort();
    const defaultInput = { foo: "bar" };
    const defaultResult = await defaultFake.execute(defaultInput);
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

  it("should apply transformation with custom behavior", async () => {
    const customFake = new FakeRenderManifestPort();
    customFake.setBehavior(async (data) => ({
      transformed: true,
      original: data,
    }));
    const customInput = { baz: 42 };
    const customResult = await customFake.execute(customInput);
    assert.deepStrictEqual(
      customResult,
      { transformed: true, original: customInput },
      "Custom fake should apply transformation",
    );
  });
});
