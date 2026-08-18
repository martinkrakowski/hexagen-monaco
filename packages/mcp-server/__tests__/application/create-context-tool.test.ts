import { describe, it } from "vitest";
import assert from "node:assert";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import { CreateContextToolUseCase } from "../../src/application/use-cases/create-context-tool.use-case.js";

describe("create context tool", () => {
  it("should return dryRun=true for dry_run request", async () => {
    const useCase = new CreateContextToolUseCase(
      new InMemoryTransactionManager(),
    );
    const result = await useCase.execute({
      name: "local-llm",
      type: "supporting",
      dry_run: true,
    });
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.registered, false);
    assert.strictEqual(result.alreadyExisted, false);
    assert.ok(result.message.includes("local-llm"));
    assert.ok(result.message.includes("supporting"));
  });

  it("should propose a transaction and not write the manifest", async () => {
    const tm = new InMemoryTransactionManager();
    const useCase = new CreateContextToolUseCase(tm);
    const result = await useCase.execute({
      name: "local-llm",
      type: "core",
      description: "Local LLM provider",
      dry_run: false,
    });
    assert.strictEqual(result.dryRun, false);
    assert.strictEqual(result.registered, false);
    assert.strictEqual(result.pendingApproval, true);
    assert.ok(result.transactionId);
    assert.ok(tm.get(result.transactionId ?? ""));
  });

  it("should throw on empty name", async () => {
    const useCase = new CreateContextToolUseCase(
      new InMemoryTransactionManager(),
    );
    await assert.rejects(
      async () => useCase.execute({ name: "", type: "core", dry_run: false }),
      /required/,
    );
  });

  it("should throw on invalid name format", async () => {
    const useCase = new CreateContextToolUseCase(
      new InMemoryTransactionManager(),
    );
    await assert.rejects(
      async () =>
        useCase.execute({ name: "Invalid_Name", type: "core", dry_run: false }),
      /kebab-case/,
    );
  });

  it("should throw on reserved name", async () => {
    const useCase = new CreateContextToolUseCase(
      new InMemoryTransactionManager(),
    );
    await assert.rejects(
      async () =>
        useCase.execute({ name: "shared", type: "core", dry_run: false }),
      /reserved/,
    );
  });

  it("should throw on invalid type", async () => {
    const useCase = new CreateContextToolUseCase(
      new InMemoryTransactionManager(),
    );
    await assert.rejects(
      async () =>
        useCase.execute({
          name: "local-llm",
          type: "unknown" as never,
          dry_run: false,
        }),
      /type must be one of/,
    );
  });
});
