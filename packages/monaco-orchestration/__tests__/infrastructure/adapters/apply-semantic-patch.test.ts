import assert from "assert";
import { FakeSemanticPatchPort } from "../../doubles/ports/apply-semantic-patch.fake";

(async () => {
  // Test 1: default behavior (no custom behavior set)
  const fakeDefault = new FakeSemanticPatchPort();
  const inputDefault = { foo: "bar" };
  const resultDefault = await fakeDefault.apply(inputDefault);
  assert.deepStrictEqual(
    resultDefault,
    inputDefault,
    "Default fake should return the input unchanged"
  );

  // Test 2: custom behavior via setBehavior
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
    "Custom behavior should transform the input as defined"
  );

  console.log("All node-assert tests for FakeSemanticPatchPort passed.");
})();
