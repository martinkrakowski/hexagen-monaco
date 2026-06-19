import { describe, it } from "vitest";
import assert from "node:assert";
import type { EventBusPort } from "@hexagen/messaging";
import type { ManifestWritePort } from "../../src/application/ports/out/manifest-write.port.js";
import { CreateContextToolUseCase } from "../../src/application/use-cases/create-context-tool.use-case.js";

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

class ManifestWriteAlreadyExistsFake extends ManifestWriteFake {
  async registerBoundedContext() {
    return {
      success: true as const,
      value: { registered: false, alreadyExisted: true },
    };
  }
}

class ManifestWriteErrorFake extends ManifestWriteFake {
  async registerBoundedContext() {
    return {
      success: false as const,
      error: new Error("disk write failure"),
    };
  }
}

class EventBusFake implements EventBusPort {
  published: unknown[] = [];
  subscribe(): () => void {
    return () => {};
  }
  publish(event: unknown): void {
    this.published.push(event);
  }
  unsubscribe(): void {}
  clear(): void {}
}

describe("create context tool", () => {
  it("should return dryRun=true for dry_run request", async () => {
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteFake(),
      new EventBusFake(),
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

  it("should create context and publish event", async () => {
    const eventBus = new EventBusFake();
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteFake(),
      eventBus,
    );
    const result = await useCase.execute({
      name: "local-llm",
      type: "core",
      description: "Local LLM provider",
      dry_run: false,
    });
    assert.strictEqual(result.dryRun, false);
    assert.strictEqual(result.registered, true);
    assert.strictEqual(result.alreadyExisted, false);
    assert.ok(result.message.includes("local-llm"));
    assert.strictEqual(eventBus.published.length, 1);
    const event = eventBus.published[0] as { type: string };
    assert.strictEqual(event.type, "ContextCreated");
  });

  it("should return alreadyExisted=true and not publish event when context exists", async () => {
    const eventBus = new EventBusFake();
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteAlreadyExistsFake(),
      eventBus,
    );
    const result = await useCase.execute({
      name: "local-llm",
      type: "core",
      dry_run: false,
    });
    assert.strictEqual(result.registered, false);
    assert.strictEqual(result.alreadyExisted, true);
    assert.ok(result.message.includes("already exists"));
    assert.strictEqual(eventBus.published.length, 0);
  });

  it("should throw when adapter fails", async () => {
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteErrorFake(),
      new EventBusFake(),
    );
    await assert.rejects(
      async () =>
        useCase.execute({ name: "local-llm", type: "core", dry_run: false }),
      (err: unknown) => (err as Error).message.includes("disk write failure"),
    );
  });

  it("should throw on empty name", async () => {
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteFake(),
      new EventBusFake(),
    );
    await assert.rejects(
      async () => useCase.execute({ name: "", type: "core", dry_run: false }),
      /required/,
    );
  });

  it("should throw on invalid name format", async () => {
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteFake(),
      new EventBusFake(),
    );
    await assert.rejects(
      async () =>
        useCase.execute({ name: "Invalid_Name", type: "core", dry_run: false }),
      /kebab-case/,
    );
  });

  it("should throw on reserved name", async () => {
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteFake(),
      new EventBusFake(),
    );
    await assert.rejects(
      async () =>
        useCase.execute({ name: "shared", type: "core", dry_run: false }),
      /reserved/,
    );
  });

  it("should throw on invalid type", async () => {
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteFake(),
      new EventBusFake(),
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
