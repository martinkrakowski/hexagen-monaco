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

  /** Reject with an error shaped the way `child_process` actually shapes it. */
  function rejectWith(props: Record<string, unknown>, message = "boom"): void {
    mockExecFileAsync = vi.fn<ExecFileAsyncFn>(async () => {
      throw Object.assign(new Error(message), props);
    });
    adapter = new CliLintValidationAdapter("/workspace", mockExecFileAsync);
  }

  const validate = () =>
    adapter.validateManifest("/workspace/.architecture/manifest.yaml");

  it("should return invalid with errors when lint:arch exits non-zero", async () => {
    // The linter RAN and reported violations: `code` is the numeric exit
    // status. This is a verdict, so it stays a successful Result.
    const errorOutput =
      "port 'FooPort' declared in 2 contexts\nmissing adapter for 'BarAdapter'";
    rejectWith({ code: 1, stderr: errorOutput }, "Command failed");

    const result = await validate();

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.valid, false);
      assert.deepStrictEqual(result.value.errors, errorOutput.split("\n"));
    }
  });

  /**
   * The `lint-unavailable` arm of AcceptTransactionUseCase only ever fires on a
   * `Result` failure. Before this split the adapter returned `success:true,
   * valid:false` for EVERY rejection — spawn failures and timeouts included —
   * so a linter that could not run reached the operator as an HTTP 200 lint
   * violation and the arm was unreachable in production.
   */
  describe("the linter could not run → Result failure, never a verdict", () => {
    it("spawn failure (ENOENT: no `yarn` on PATH)", async () => {
      // Node reports spawn errors with a STRING errno in `code`, not an exit
      // status. There is no exit status, because nothing ran.
      rejectWith(
        { code: "ENOENT", errno: -2, syscall: "spawn yarn" },
        "spawn yarn ENOENT",
      );

      const result = await validate();

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.match(result.error.message, /could not be run/i);
      }
    });

    it("the 60s timeout killing the linter mid-run", async () => {
      // Timeout kills the child: `killed` is set and `code` is null.
      rejectWith(
        { code: null, killed: true, signal: "SIGTERM" },
        "Command failed: yarn lint:arch",
      );

      const result = await validate();

      assert.strictEqual(result.success, false);
    });

    it("an unclassifiable rejection (fails toward 'no verdict')", async () => {
      // No `code`, no `signal`: we cannot show the exit status proving the
      // linter reached a verdict, so we must not invent one.
      rejectWith({}, "something unexpected");

      const result = await validate();

      assert.strictEqual(result.success, false);
    });
  });
});
