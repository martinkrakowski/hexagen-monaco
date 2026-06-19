import assert from "node:assert/strict";
import { describe, it, beforeEach, vi } from "vitest";
import { CliLintValidationAdapter } from "../../../src/infrastructure/adapters/cli-lint-validation.adapter.js";

type ExecFileAsyncFn = (
  file: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

describe("CliLintValidationAdapter", () => {
  let adapter: CliLintValidationAdapter;
  let mockExecFileAsync: ReturnType<typeof vi.fn<ExecFileAsyncFn>>;

  beforeEach(() => {
    mockExecFileAsync = vi.fn<ExecFileAsyncFn>(async () => ({
      stdout: "",
      stderr: "",
    }));
    adapter = new CliLintValidationAdapter("/workspace", mockExecFileAsync);
  });

  it("should return valid when lint:arch succeeds", async () => {
    const result = await adapter.validateManifest(
      "/workspace/.architecture/manifest.yaml",
    );

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.valid, true);
      assert.strictEqual(result.value.errors.length, 0);
    }

    assert.strictEqual(mockExecFileAsync.mock.calls[0][0], "yarn");
    assert.deepStrictEqual(mockExecFileAsync.mock.calls[0][1], ["lint:arch"]);
    assert.strictEqual(
      (mockExecFileAsync.mock.calls[0][2] as Record<string, unknown>).cwd,
      "/workspace",
    );
  });

  it("should return invalid with errors when lint:arch fails", async () => {
    const errorOutput =
      "port 'FooPort' declared in 2 contexts\nmissing adapter for 'BarAdapter'";

    mockExecFileAsync = vi.fn<ExecFileAsyncFn>(async () => {
      const err = new Error("Command failed") as Error & { stderr: string };
      err.stderr = errorOutput;
      throw err;
    });
    adapter = new CliLintValidationAdapter("/workspace", mockExecFileAsync);

    const result = await adapter.validateManifest(
      "/workspace/.architecture/manifest.yaml",
    );

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.valid, false);
      assert.ok(result.value.errors.length > 0);
    }
  });

  it("should handle error without stderr", async () => {
    mockExecFileAsync = vi.fn<ExecFileAsyncFn>(async () => {
      throw new Error("timeout exceeded");
    });
    adapter = new CliLintValidationAdapter("/workspace", mockExecFileAsync);

    const result = await adapter.validateManifest(
      "/workspace/.architecture/manifest.yaml",
    );

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.valid, false);
    }
  });
});
