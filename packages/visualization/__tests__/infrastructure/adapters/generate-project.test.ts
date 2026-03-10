// Minimal test suite for IGenerateProjectPort in the visualization package.
import assert from "node:assert";
import { FakeGenerateProjectPort } from "../../doubles/ports/generate-project.fake";

(async () => {
  // Default behavior – echo input
  const defaultFake = new FakeGenerateProjectPort();
  const defaultInput = { foo: "bar" };
  const defaultResult = await defaultFake.execute(defaultInput);
  assert.deepStrictEqual(
    defaultResult,
    defaultInput,
    "Default fake should return the input unchanged",
  );

  // Custom behavior – transform the input
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
    "Custom behavior should transform the input",
  );

  console.log("✅ All IGenerateProjectPort tests passed.");
})();
