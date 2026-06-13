import { describe, it } from "node:test";
import assert from "node:assert";
import { FakeValidateSpecPort } from "../../doubles/ports/validate-spec.fake";

describe("validate-spec", () => {
  it("returns the default success response when no behavior is set", async () => {
    const defaultFake = new FakeValidateSpecPort();
    const defaultResult = await defaultFake.execute({
      spec: { id: "test", name: "test" },
    });
    assert.deepStrictEqual(
      defaultResult,
      { success: true },
      "the default fake should report a successful validation",
    );
  });

  it("applies a custom behavior when one is set", async () => {
    const customFake = new FakeValidateSpecPort();
    customFake.setBehavior(async () => ({
      success: false,
      errors: ["custom"],
    }));
    const customResult = await customFake.execute({
      spec: { id: "c", name: "c" },
    });
    assert.deepStrictEqual(
      customResult,
      { success: false, errors: ["custom"] },
      "a custom behavior should override the default response",
    );
  });
});
