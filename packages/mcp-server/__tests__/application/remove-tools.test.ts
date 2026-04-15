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

(async () => {
  const eventBus = new EventBusFake();

  {
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
  }
  console.log("  ✅ RemovePortToolUseCase: dry_run returns dryRun=true");

  {
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
  }
  console.log("  ✅ RemovePortToolUseCase: removes port and publishes event");

  {
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
  }
  console.log(
    "  ✅ RemovePortToolUseCase: returns removed=false when not found",
  );

  {
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
  }
  console.log("  ✅ RemovePortToolUseCase: throws when adapter fails");

  {
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
  }
  console.log("  ✅ RemovePortToolUseCase: throws on empty context_name");

  {
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
  }
  console.log("  ✅ RemoveContextToolUseCase: dry_run returns dryRun=true");

  {
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
  }
  console.log(
    "  ✅ RemoveContextToolUseCase: removes context and publishes event",
  );

  {
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
  }
  console.log(
    "  ✅ RemoveContextToolUseCase: returns removed=false when not found",
  );

  {
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
  }
  console.log("  ✅ RemoveContextToolUseCase: throws when adapter fails");

  {
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
  }
  console.log("  ✅ RemoveContextToolUseCase: throws on empty context_name");

  console.log("✅ remove-tools use-case tests passed");
})();
