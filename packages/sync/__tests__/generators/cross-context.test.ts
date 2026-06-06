import { describe, it } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { generateCrossContext } from "../../src/generators/cross-context.js";
import type { Manifest } from "../../src/types/manifest.js";
import { createSpyLogger } from "../helpers/spy-logger.js";
import {
  withTempWorkspace,
  pathExists,
  readText,
} from "../helpers/fs-helpers.js";
import { makeConfig } from "../helpers/test-config.js";

const eventBusManifest = (): Manifest =>
  ({
    system: "myorg",
    scope: "myorg",
    bounded_contexts: [
      { name: "orders" },
      { name: "billing" },
      { name: "shared" },
    ],
    cross_context: [
      {
        consumer: "orders",
        provider: "billing",
        transport: "event-bus",
        events: ["InvoiceIssued", "PaymentReceived"],
        integrationPattern: "open-host",
      },
    ],
  }) as unknown as Manifest;

describe("cross-context (event-bus transport emitter)", () => {
  it("emits shared contracts + bespoke ports with REAL methods (not generic stubs) + derived adapters", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const config = makeConfig(workspaceRoot, eventBusManifest(), {
        logger: createSpyLogger(),
      });

      const result = await generateCrossContext(config);
      assert.strictEqual(result.error, undefined, "emitter must not error");

      // 1. Shared event contracts (cross-package).
      const invoice = path.join(
        workspaceRoot,
        "packages/shared/src/domain/events/InvoiceIssued.event.ts",
      );
      assert.strictEqual(
        await pathExists(invoice),
        true,
        "shared contract emitted",
      );
      assert.ok(
        (await readText(invoice)).includes("export interface InvoiceIssued"),
      );

      // 2. Publisher port on the PROVIDER (billing) — the crux: a REAL publish
      //    method referencing the provider's events, NOT the generic outPort stub.
      const pubPort = path.join(
        workspaceRoot,
        "packages/billing/src/application/ports/out/message-publisher.out-port.ts",
      );
      assert.strictEqual(
        await pathExists(pubPort),
        true,
        "publisher port emitted",
      );
      const pub = await readText(pubPort);
      assert.ok(
        pub.includes("export interface MessagePublisherPort"),
        "publisher interface present",
      );
      assert.match(
        pub,
        /publish\(event:[^)]*InvoiceIssued[^)]*PaymentReceived[^)]*\): Promise<void>/,
        "publisher has a real publish(event: <provider events>) method",
      );
      // Explicitly pin "bespoke, not generic stub" so it can't regress silently:
      assert.ok(
        !pub.includes("Define your port methods"),
        "must NOT be the generic outPort stub body",
      );
      assert.ok(
        !pub.includes("TODO: Define"),
        "must NOT carry the generic stub's TODO",
      );

      // 3. Subscriber port on the CONSUMER (orders) — real handle method.
      const subPort = path.join(
        workspaceRoot,
        "packages/orders/src/application/ports/in/event-listener.in-port.ts",
      );
      assert.strictEqual(
        await pathExists(subPort),
        true,
        "subscriber port emitted",
      );
      const sub = await readText(subPort);
      assert.ok(sub.includes("export interface EventListenerPort"));
      assert.match(
        sub,
        /handle\(event:[^)]*InvoiceIssued[^)]*\): Promise<void>/,
        "subscriber has a real handle(event: ...) method",
      );

      // 4. Adapter derived from the bespoke port (via generateAdapterFromPort).
      const pubAdapter = path.join(
        workspaceRoot,
        "packages/billing/src/infrastructure/adapters/message-publisher.adapter.ts",
      );
      assert.strictEqual(
        await pathExists(pubAdapter),
        true,
        "publisher adapter derived",
      );
      const adapter = await readText(pubAdapter);
      // Adapter class name must be a VALID TS identifier (PascalCase + `Adapter`),
      // not the kebab port base — `export class message-publisher` would be a
      // compile error in the generated project. Pin both the valid form and the
      // absence of the kebab regression.
      assert.match(
        adapter,
        /export class MessagePublisherAdapter implements MessagePublisherPort/,
        "adapter has a valid PascalCase class name implementing the port",
      );
      assert.ok(
        !adapter.includes("class message-publisher"),
        "adapter class name must not be the kebab portBase (invalid identifier)",
      );
      // The adapter is a throwing stub implementing the typed port. Its `publish`
      // param resolves to `any` (ts-morph can't resolve the cross-package event
      // import, and the `InvoiceIssued | PaymentReceived` union of unresolved
      // types collapses to `any`); the PORT carries the real union and `any` still
      // satisfies it, so the boundary compiles. Pin the method + stub body, not the
      // param type, so this stays robust if analyzer fidelity improves later.
      assert.match(
        adapter,
        /async publish\(event: [^)]*\): Promise<void>/,
        "adapter implements the publish method against the port",
      );
      assert.ok(
        adapter.includes("throw new Error"),
        "adapter body is a fill-in TODO stub (C1)",
      );
    });
  });

  it("emits nothing (and creates no packages/) when there is no cross_context", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const config = makeConfig(
        workspaceRoot,
        { system: "myorg", bounded_contexts: [] } as unknown as Manifest,
        { logger: createSpyLogger() },
      );
      const result = await generateCrossContext(config);
      assert.strictEqual(result.totalOps, 0);
      assert.strictEqual(
        await pathExists(path.join(workspaceRoot, "packages")),
        false,
        "no files written without cross_context",
      );
    });
  });
});
