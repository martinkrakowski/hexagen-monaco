import { CliLintValidationAdapter } from "../../../src/infrastructure/adapters/cli-lint-validation.adapter.js";

jest.mock("node:child_process", () => ({
  execFile: jest.fn(),
}));

import { execFile } from "node:child_process";

const mockExecFile = execFile as jest.Mock;

describe("CliLintValidationAdapter", () => {
  let adapter: CliLintValidationAdapter;

  beforeEach(() => {
    adapter = new CliLintValidationAdapter("/workspace");
    mockExecFile.mockReset();
  });

  it("should return valid when lint:arch succeeds", async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        callback: (err: null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, "", "");
      },
    );

    const result = await adapter.validateManifest(
      "/workspace/.architecture/manifest.yaml",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.valid).toBe(true);
      expect(result.value.errors).toHaveLength(0);
    }

    expect(mockExecFile).toHaveBeenCalledWith(
      "yarn",
      ["lint:arch"],
      expect.objectContaining({ cwd: "/workspace" }),
      expect.any(Function),
    );
  });

  it("should return invalid with errors when lint:arch fails", async () => {
    const errorOutput =
      "port 'FooPort' declared in 2 contexts\nmissing adapter for 'BarAdapter'";
    const err = new Error("Command failed") as Error & { stderr: string };
    err.stderr = errorOutput;

    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        callback: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(err, "", errorOutput);
      },
    );

    const result = await adapter.validateManifest(
      "/workspace/.architecture/manifest.yaml",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.valid).toBe(false);
      expect(result.value.errors.length).toBeGreaterThan(0);
    }
  });

  it("should handle error without stderr", async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        callback: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(new Error("timeout exceeded"), "", "");
      },
    );

    const result = await adapter.validateManifest(
      "/workspace/.architecture/manifest.yaml",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.valid).toBe(false);
    }
  });
});
