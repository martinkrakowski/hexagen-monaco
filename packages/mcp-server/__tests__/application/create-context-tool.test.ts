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

(async () => {
  // ── dry_run ──────────────────────────────────────────────────────────────
  {
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
  }
  console.log("  ✅ CreateContextToolUseCase: dry_run returns dryRun=true");

  // ── happy path — creates context and publishes event ─────────────────────
  {
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
  }
  console.log(
    "  ✅ CreateContextToolUseCase: creates context and publishes event",
  );

  // ── already existed — no event published ─────────────────────────────────
  {
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
  }
  console.log(
    "  ✅ CreateContextToolUseCase: returns alreadyExisted=true, no event",
  );

  // ── adapter failure propagates ────────────────────────────────────────────
  {
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteErrorFake(),
      new EventBusFake(),
    );
    await assert.rejects(
      async () =>
        useCase.execute({ name: "local-llm", type: "core", dry_run: false }),
      (err: unknown) => (err as Error).message.includes("disk write failure"),
    );
  }
  console.log("  ✅ CreateContextToolUseCase: throws when adapter fails");

  // ── invalid name — empty ──────────────────────────────────────────────────
  {
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteFake(),
      new EventBusFake(),
    );
    await assert.rejects(
      async () => useCase.execute({ name: "", type: "core", dry_run: false }),
      /required/,
    );
  }
  console.log("  ✅ CreateContextToolUseCase: throws on empty name");

  // ── invalid name — fails kebab-case regex ─────────────────────────────────
  {
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteFake(),
      new EventBusFake(),
    );
    await assert.rejects(
      async () =>
        useCase.execute({ name: "Invalid_Name", type: "core", dry_run: false }),
      /kebab-case/,
    );
  }
  console.log("  ✅ CreateContextToolUseCase: throws on invalid name format");

  // ── reserved name ─────────────────────────────────────────────────────────
  {
    const useCase = new CreateContextToolUseCase(
      new ManifestWriteFake(),
      new EventBusFake(),
    );
    await assert.rejects(
      async () =>
        useCase.execute({ name: "shared", type: "core", dry_run: false }),
      /reserved/,
    );
  }
  console.log("  ✅ CreateContextToolUseCase: throws on reserved name");

  // ── invalid type ──────────────────────────────────────────────────────────
  {
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
  }
  console.log("  ✅ CreateContextToolUseCase: throws on invalid type");

  console.log("✅ create-context-tool use-case tests passed");
})();
