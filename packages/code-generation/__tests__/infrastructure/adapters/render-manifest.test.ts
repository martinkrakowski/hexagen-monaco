import assert from "node:assert";
import { describe, it } from "vitest";
import { FakeRenderManifestPort } from "../../doubles/ports/render-manifest.fake";

describe("render-manifest", () => {
  it("should return the input unchanged by default", async () => {
    const defaultFake = new FakeRenderManifestPort();
    const defaultInput = { foo: "bar" };
    const defaultResult = await defaultFake.execute(defaultInput);
    assert.deepStrictEqual(
      defaultResult,
      defaultInput,
      "Default fake should return the input unchanged",
    );
  });

  it("should apply custom transformation when behavior is set", async () => {
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
