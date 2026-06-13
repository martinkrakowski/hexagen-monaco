import { describe, it } from "node:test";
import assert from "node:assert";
import { FakeValidateSpecPort } from "../../doubles/ports/validate-spec.fake";

describe("validate-spec", () => {
  it("returns the default success response when no behavior is set", async () => {
    const defaultFake = new FakeValidateSpecPort();
    const defaultInput = { foo: "bar" };
    const defaultResult = await defaultFake.execute(defaultInput);
    assert.deepStrictEqual(
      defaultResult,
      { success: true },
      "the default fake should report a successful validation",
    );
  });

  it("should apply transformation with custom behavior", async () => {
    const customFake = new FakeValidateSpecPort();
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
