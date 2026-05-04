import { describe, it } from "node:test";
import assert from "node:assert";
import { FakeGenerateProjectPort } from "../../doubles/ports/generate-project.fake";

describe("generate-project", () => {
  it("should return input unchanged with default behavior", async () => {
    const defaultFake = new FakeGenerateProjectPort();
    const defaultInput = { foo: "bar" };
    const defaultResult = await defaultFake.execute(defaultInput);
    assert.deepStrictEqual(
      defaultResult,
      defaultInput,
      "Default fake should return the input unchanged",
    );
  });

  it("should apply transformation with custom behavior", async () => {
    const customFake = new FakeGenerateProjectPort();
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
