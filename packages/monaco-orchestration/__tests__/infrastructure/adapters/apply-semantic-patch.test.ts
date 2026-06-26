import assert from "assert";
import { describe, it } from "vitest";
import { FakeSemanticPatchPort } from "../../doubles/ports/apply-semantic-patch.fake";

describe("apply-semantic-patch", () => {
  it("should return the input unchanged by default", async () => {
    const fakeDefault = new FakeSemanticPatchPort();
    const inputDefault = { foo: "bar" };
    const resultDefault = await fakeDefault.apply(inputDefault);
    assert.deepStrictEqual(
      resultDefault,
      inputDefault,
      "Default fake should return the input unchanged",
    );
  });

  it("should apply custom transformation when behavior is set", async () => {
    const fakeCustom = new FakeSemanticPatchPort();
    const inputCustom = { baz: 42 };
    fakeCustom.setBehavior(async (data) => ({
      transformed: true,
      original: data,
    }));
    const resultCustom = await fakeCustom.apply(inputCustom);
    assert.deepStrictEqual(
      resultCustom,
      {
        transformed: true,
        original: inputCustom,
      },
      "Custom behavior should transform the input as defined",
    );
  });
});
