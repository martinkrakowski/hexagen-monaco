import type { Result } from "@hexagen/shared";
import { describe, expect, it } from "vitest";
import type {
  Intent,
  IntentBusPort,
} from "../../../src/domain/ports/intent-bus.port";
import { InMemoryIntentBusAdapter } from "../../../src/infrastructure/adapters/in-memory-intent-bus.adapter";

/**
 * Contract test for the live intent bus.
 *
 * `InMemoryIntentBusAdapter` is the IntentBusPort implementation the web app
 * actually runs: `apps/web/app/lib/wire.shared.ts` constructs it in
 * `createIntentBus()`, and `wire.client.ts` registers that instance under
 * `PORT_NAMES.INTENT_BUS`. It had no test of any kind — the package's only
 * infrastructure suites were `EchoFakePort` subclasses naming ports owned by
 * `project-configuration` (AUD-018).
 *
 * The subject is bound through `IntentBusPort` rather than the concrete class,
 * so every assertion below is made against the port contract: an adapter that
 * stopped satisfying the interface fails to compile here, and the runtime
 * assertions only ever exercise methods the port declares.
 */
const newBus = (): IntentBusPort => new InMemoryIntentBusAdapter();

const intent = <T>(type: string, payload: T): Intent<T> => ({
  type,
  payload,
  timestamp: 0,
  correlationId: `cid-${type}`,
});

/** Assert the failure arm and hand back its error, which `Result` cannot narrow to. */
const errorOf = (result: Result<unknown>): unknown => {
  expect(result.success, "the dispatch was expected to fail").toBe(false);
  return (result as { success: false; error: unknown }).error;
};

describe("InMemoryIntentBusAdapter (IntentBusPort contract)", () => {
  it("routes a dispatched intent to the handler registered for its type", async () => {
    const bus = newBus();
    const seen: Intent<{ n: number }>[] = [];

    bus.register<{ n: number }, number>("add", async (received) => {
      seen.push(received);
      return { success: true, value: received.payload.n + 1 };
    });

    const result = await bus.dispatch<{ n: number }, number>(
      intent("add", { n: 41 }),
    );

    expect(result).toEqual({ success: true, value: 42 });
    expect(seen, "the handler must be invoked exactly once").toHaveLength(1);
    expect(seen[0]!.correlationId).toBe("cid-add");
  });

  it("dispatches only to the handler whose type matches", async () => {
    const bus = newBus();
    const invoked: string[] = [];

    bus.register("wanted", async () => {
      invoked.push("wanted");
      return { success: true, value: null };
    });
    bus.register("other", async () => {
      invoked.push("other");
      return { success: true, value: null };
    });

    await bus.dispatch(intent("wanted", {}));

    expect(
      invoked,
      "a dispatch must not fan out to handlers of other intent types",
    ).toEqual(["wanted"]);
  });

  it("rejects a second registration for an already-registered type", () => {
    const bus = newBus();
    bus.register("duplicate", async () => ({ success: true, value: null }));

    expect(
      () =>
        bus.register("duplicate", async () => ({ success: true, value: null })),
      "single-ownership of an intent type must be enforced at registration",
    ).toThrow(/Intent handler already registered for type: duplicate/);
  });

  it("keeps the first handler after a rejected duplicate registration", async () => {
    const bus = newBus();
    bus.register("owned", async () => ({ success: true, value: "first" }));

    expect(() =>
      bus.register("owned", async () => ({ success: true, value: "second" })),
    ).toThrow();

    const result = await bus.dispatch<unknown, string>(intent("owned", {}));
    expect(
      result,
      "the rejected registration must not have overwritten the incumbent",
    ).toEqual({ success: true, value: "first" });
  });

  it("returns a failure Result — rather than throwing — for an unhandled type", async () => {
    const bus = newBus();

    const error = errorOf(
      await bus.dispatch(intent("nobody-handles-this", {})),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /No handler registered for intent type: nobody-handles-this/,
    );
  });

  it("converts a handler that throws an Error into a failure Result carrying it", async () => {
    const bus = newBus();
    const thrown = new Error("handler exploded");
    bus.register("boom", async () => {
      throw thrown;
    });

    const result = await bus.dispatch(intent("boom", {}));

    expect(
      result,
      "the original Error must survive, not be re-wrapped",
    ).toEqual({ success: false, error: thrown });
    expect((result as { error: unknown }).error).toBe(thrown);
  });

  it("converts a handler that throws a non-Error into a failure Result with an Error", async () => {
    const bus = newBus();
    bus.register("string-throw", async () => {
      throw "not an error object";
    });

    const error = errorOf(await bus.dispatch(intent("string-throw", {})));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("not an error object");
  });

  it("stops routing to a handler once its type is unregistered", async () => {
    const bus = newBus();
    let invocations = 0;
    bus.register("transient", async () => {
      invocations += 1;
      return { success: true, value: null };
    });

    await bus.dispatch(intent("transient", {}));
    bus.unregister("transient");
    const afterUnregister = await bus.dispatch(intent("transient", {}));

    expect(invocations, "the handler must not run after unregister").toBe(1);
    expect(afterUnregister.success).toBe(false);
  });

  it("frees the type for re-registration after unregister", async () => {
    const bus = newBus();
    bus.register("reusable", async () => ({ success: true, value: "old" }));
    bus.unregister("reusable");

    expect(
      () =>
        bus.register("reusable", async () => ({
          success: true,
          value: "new",
        })),
      "unregister must release the single-ownership slot, not merely stop routing",
    ).not.toThrow();

    const result = await bus.dispatch<unknown, string>(intent("reusable", {}));
    expect(result).toEqual({ success: true, value: "new" });
  });

  it("lists exactly the currently registered intent types", () => {
    const bus = newBus();
    expect(
      bus.listRegistered(),
      "a fresh bus must report no registrations",
    ).toEqual([]);

    bus.register("first", async () => ({ success: true, value: null }));
    bus.register("second", async () => ({ success: true, value: null }));
    expect([...bus.listRegistered()].sort()).toEqual(["first", "second"]);

    bus.unregister("first");
    expect(bus.listRegistered()).toEqual(["second"]);
  });
});
