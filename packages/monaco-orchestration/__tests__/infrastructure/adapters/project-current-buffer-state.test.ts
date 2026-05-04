import assert from "node:assert";
import { describe, it } from "node:test";
import { FakeProjectCurrentBufferStatePort } from "../../doubles/ports/project-current-buffer-state.fake";

describe("project-current-buffer-state", () => {
  it("should echo the input by default", async () => {
    const defaultFake = new FakeProjectCurrentBufferStatePort();
    const defaultInput = { foo: "bar" };
    const defaultResult = await defaultFake.getCurrentState(defaultInput);
    assert.deepStrictEqual(
      defaultResult,
      defaultInput,
      "Default fake should echo the input",
    );
  });

  it("should apply custom transformation when behavior is set", async () => {
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
  });
});
