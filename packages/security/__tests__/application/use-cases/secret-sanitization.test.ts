import { describe, it } from "vitest";
import assert from "node:assert";
import type { ISecretScanner } from "../../../src/application/ports/in/secret-scanner.port.js";
import type { SanitizedConfig } from "../../../src/domain/value-objects/sanitized-config.js";
import { SecretSanitizationUseCase } from "../../../src/application/use-cases/secret-sanitization.use-case.js";

describe("SecretSanitizationUseCase", () => {
  it("returns clean result for config without secrets", async () => {
    const mockScanner: ISecretScanner = {
      scan: async () => ({
        ok: true,
        value: {
          _tag: "SanitizedConfig" as const,
          originalLength: 100,
          redactedCount: 0,
          redactedKeys: [],
          scanTimestamp: new Date(),
          isClean: true,
        },
      }),
    };
    const useCase = new SecretSanitizationUseCase(mockScanner);
    const result = await useCase.execute(
      "This is a safe config without any secrets",
    );

    assert.ok(result.ok);
    assert.strictEqual((result.value as SanitizedConfig).isClean, true);
  });

  it("returns dirty result when secrets detected", async () => {
    const mockScanner: ISecretScanner = {
      scan: async () => ({
        ok: true,
        value: {
          _tag: "SanitizedConfig" as const,
          originalLength: 200,
          redactedCount: 1,
          redactedKeys: ["AKIAIOSFODNN7EXAMPLE"],
          scanTimestamp: new Date(),
          isClean: false,
        },
      }),
    };
    const useCase = new SecretSanitizationUseCase(mockScanner);
    const result = await useCase.execute("aws_access_key=AKIAIOSFODNN7EXAMPLE");

    assert.ok(result.ok);
    assert.strictEqual((result.value as SanitizedConfig).isClean, false);
    assert.strictEqual((result.value as SanitizedConfig).redactedCount, 1);
  });

  it("returns Result.err() when scanner fails", async () => {
    const mockScanner: ISecretScanner = {
      scan: async () => ({
        ok: false,
        error: {
          _tag: "SecretLeakError" as const,
          redactedKeys: [],
          scanTimestamp: new Date(),
        },
      }),
    };
    const useCase = new SecretSanitizationUseCase(mockScanner);
    const result = await useCase.execute("some config");

    assert.ok(!result.ok);
    assert.strictEqual((result as any).error._tag, "SecretLeakError");
  });
});
