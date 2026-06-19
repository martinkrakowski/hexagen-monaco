import { describe, it } from "vitest";
import assert from "node:assert";
import type { EventBusPort } from "@hexagen/messaging";
import type { ManifestWritePort } from "../../src/application/ports/out/manifest-write.port.js";
import { RemoveContextToolUseCase } from "../../src/application/use-cases/remove-context-tool.use-case.js";
import { RemovePortToolUseCase } from "../../src/application/use-cases/remove-port-tool.use-case.js";

class ManifestWriteFake implements ManifestWritePort {
  async validateDependency() {
    return {
      success: true as const,
      value: { valid: true, errors: [] as string[] },
    };
  }
  async addDependency() {
    return { success: true as const, value: { updated: true } };
  }
  async registerBoundedContext() {
    return {
      success: true as const,
      value: { registered: true, alreadyExisted: false },
    };
  }
  async registerPort() {
    return { success: true as const, value: { registered: true } };
  }
  async registerAdapter() {
    return { success: true as const, value: { registered: true } };
  }
  async removePort() {
    return { success: true as const, value: { removed: true } };
  }
  async removeContext() {
    return { success: true as const, value: { removed: true } };
  }
}

class EventBusFake implements EventBusPort {
  subscribe(): () => void {
    return () => {};
  }
  publish(): void {}
  unsubscribe(): void {}
  clear(): void {}
}

class ManifestWriteNotFoundFake {
  async removePort() {
    return { success: true, value: { removed: false } };
  }
  async removeContext() {
    return { success: true, value: { removed: false } };
  }
}

class ManifestWriteErrorFake {
  async removePort() {
    return {
      success: false,
      error: new Error("context not found"),
    };
  }
  async removeContext() {
    return {
      success: false,
      error: new Error("context not found"),
    };
  }
}

describe("remove tools", () => {
  const eventBus = new EventBusFake();

  it("should return dryRun=true for RemovePortTool dry_run", async () => {
    const useCase = new RemovePortToolUseCase(
      new ManifestWriteFake() as never,
      eventBus,
    );
    const result = await useCase.execute({
      context_name: "billing",
      port_name: "PaymentPort",
      direction: "outbound",
      dry_run: true,
    });
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.removed, false);
  });

  it("should remove port and publish event for RemovePortTool", async () => {
    const useCase = new RemovePortToolUseCase(
      new ManifestWriteFake() as never,
      eventBus,
    );
    const result = await useCase.execute({
      context_name: "billing",
      port_name: "PaymentPort",
      direction: "outbound",
      dry_run: false,
    });
    assert.strictEqual(result.dryRun, false);
    assert.strictEqual(result.removed, true);
    assert.ok(result.message.includes("billing"));
  });

  it("should return removed=false when port not found for RemovePortTool", async () => {
    const useCase = new RemovePortToolUseCase(
      new ManifestWriteNotFoundFake() as never,
      eventBus,
    );
    const result = await useCase.execute({
      context_name: "billing",
      port_name: "NonExistent",
      direction: "inbound",
      dry_run: false,
    });
    assert.strictEqual(result.removed, false);
    assert.ok(result.message.includes("not found"));
  });

  it("should throw when adapter fails for RemovePortTool", async () => {
    const useCase = new RemovePortToolUseCase(
      new ManifestWriteErrorFake() as never,
      eventBus,
    );
    await assert.rejects(
      async () =>
        useCase.execute({
          context_name: "billing",
          port_name: "PaymentPort",
          direction: "outbound",
          dry_run: false,
        }),
      (err: unknown) => (err as Error).message.includes("context not found"),
    );
  });

  it("should throw on empty context_name for RemovePortTool", async () => {
    const useCase = new RemovePortToolUseCase(
      new ManifestWriteFake() as never,
      eventBus,
    );
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
      new ManifestWriteFake() as never,
      eventBus,
    );
    const result = await useCase.execute({
      context_name: "billing",
      dry_run: true,
    });
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.removed, false);
  });

  it("should remove context and publish event for RemoveContextTool", async () => {
    const useCase = new RemoveContextToolUseCase(
      new ManifestWriteFake() as never,
      eventBus,
    );
    const result = await useCase.execute({
      context_name: "billing",
      dry_run: false,
    });
    assert.strictEqual(result.dryRun, false);
    assert.strictEqual(result.removed, true);
    assert.ok(result.message.includes("billing"));
  });

  it("should return removed=false when context not found for RemoveContextTool", async () => {
    const useCase = new RemoveContextToolUseCase(
      new ManifestWriteNotFoundFake() as never,
      eventBus,
    );
    const result = await useCase.execute({
      context_name: "nonexistent",
      dry_run: false,
    });
    assert.strictEqual(result.removed, false);
    assert.ok(result.message.includes("not found"));
  });

  it("should throw when adapter fails for RemoveContextTool", async () => {
    const useCase = new RemoveContextToolUseCase(
      new ManifestWriteErrorFake() as never,
      eventBus,
    );
    await assert.rejects(
      async () =>
        useCase.execute({
          context_name: "billing",
          dry_run: false,
        }),
      (err: unknown) => (err as Error).message.includes("context not found"),
    );
  });

  it("should throw on empty context_name for RemoveContextTool", async () => {
    const useCase = new RemoveContextToolUseCase(
      new ManifestWriteFake() as never,
      eventBus,
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
