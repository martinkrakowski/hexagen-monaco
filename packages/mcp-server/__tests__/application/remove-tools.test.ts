import { describe, it } from "vitest";
import assert from "node:assert";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import { RemoveContextToolUseCase } from "../../src/application/use-cases/remove-context-tool.use-case.js";
import { RemovePortToolUseCase } from "../../src/application/use-cases/remove-port-tool.use-case.js";

describe("remove tools", () => {
  it("should return dryRun=true for RemovePortTool dry_run", async () => {
    const useCase = new RemovePortToolUseCase(new InMemoryTransactionManager());
    const result = await useCase.execute({
      context_name: "billing",
      port_name: "PaymentPort",
      direction: "outbound",
      dry_run: true,
    });
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.removed, false);
  });

  it("should propose a port removal without writing", async () => {
    const useCase = new RemovePortToolUseCase(new InMemoryTransactionManager());
    const result = await useCase.execute({
      context_name: "billing",
      port_name: "PaymentPort",
      direction: "outbound",
      dry_run: false,
    });
    assert.strictEqual(result.dryRun, false);
    assert.strictEqual(result.removed, false);
    assert.strictEqual(result.pendingApproval, true);
    assert.ok(result.transactionId);
  });

  it("should throw on empty context_name for RemovePortTool", async () => {
    const useCase = new RemovePortToolUseCase(new InMemoryTransactionManager());
    await assert.rejects(
      async () =>
        useCase.execute({
          context_name: "",
          port_name: "PaymentPort",
          direction: "outbound",
        }),
      /required/,
    );
  });

  it("should return dryRun=true for RemoveContextTool dry_run", async () => {
    const useCase = new RemoveContextToolUseCase(
      new InMemoryTransactionManager(),
    );
    const result = await useCase.execute({
      context_name: "billing",
      dry_run: true,
    });
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.removed, false);
  });

  it("should propose a context removal without writing", async () => {
    const useCase = new RemoveContextToolUseCase(
      new InMemoryTransactionManager(),
    );
    const result = await useCase.execute({
      context_name: "billing",
      dry_run: false,
    });
    assert.strictEqual(result.dryRun, false);
    assert.strictEqual(result.removed, false);
    assert.strictEqual(result.pendingApproval, true);
    assert.ok(result.message.includes("billing"));
  });

  it("should throw on empty context_name for RemoveContextTool", async () => {
    const useCase = new RemoveContextToolUseCase(
      new InMemoryTransactionManager(),
    );
    await assert.rejects(
      async () =>
        useCase.execute({
          context_name: "",
          dry_run: false,
        }),
      /required/,
    );
  });
});
