import { CliLintValidationAdapter } from "../../../src/infrastructure/adapters/cli-lint-validation.adapter.js";

jest.mock("node:child_process", () => ({
  execSync: jest.fn(),
}));

import { execSync } from "node:child_process";

const mockExecSync = execSync as jest.Mock;

describe("CliLintValidationAdapter", () => {
  let adapter: CliLintValidationAdapter;

  beforeEach(() => {
    adapter = new CliLintValidationAdapter("/workspace");
    mockExecSync.mockReset();
  });

  it("should return valid when lint:arch succeeds", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await adapter.validateManifest(
      "/workspace/.architecture/manifest.yaml",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.valid).toBe(true);
      expect(result.value.errors).toHaveLength(0);
    }

    expect(mockExecSync).toHaveBeenCalledWith(
      "yarn lint:arch",
      expect.objectContaining({ cwd: "/workspace" }),
    );
  });

  it("should return invalid with errors when lint:arch fails", async () => {
    const errorOutput =
      "port 'FooPort' declared in 2 contexts\nmissing adapter for 'BarAdapter'";
    mockExecSync.mockImplementation(() => {
      const err = new Error("Command failed");
      (err as Error & { stderr: string }).stderr = errorOutput;
      throw err;
    });

    const result = await adapter.validateManifest(
      "/workspace/.architecture/manifest.yaml",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.valid).toBe(false);
      expect(result.value.errors.length).toBeGreaterThan(0);
      expect(result.value.errors[0]).toContain("port 'FooPort'");
    }
  });

  it("should handle error without stderr", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("timeout exceeded");
    });

    const result = await adapter.validateManifest(
      "/workspace/.architecture/manifest.yaml",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.valid).toBe(false);
      expect(result.value.errors).toContain("timeout exceeded");
    }
  });
});
