import assert from "node:assert";
import { FakeProjectCurrentBufferStatePort } from "../../doubles/ports/project-current-buffer-state.fake";

(async () => {
  // Default behavior – echo the input data
  const defaultFake = new FakeProjectCurrentBufferStatePort();
  const defaultInput = { foo: "bar" };
  const defaultResult = await defaultFake.getCurrentState(defaultInput);
  assert.deepStrictEqual(
    defaultResult,
    defaultInput,
    "Default fake should echo the input",
  );

  // Custom behavior – transform the input data
  const customFake = new FakeProjectCurrentBufferStatePort();
  customFake.setBehavior(async (data) => ({
    transformed: true,
    original: data,
  }));
  const customInput = { baz: 42 };
  const customResult = await customFake.getCurrentState(customInput);
  assert.deepStrictEqual(
    customResult,
    { transformed: true, original: customInput },
    "Custom fake should apply transformation",
  );

  console.log("All FakeProjectCurrentBufferStatePort tests passed.");
})();
