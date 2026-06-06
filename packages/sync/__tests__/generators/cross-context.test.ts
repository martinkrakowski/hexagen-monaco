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

const networkManifest = (): Manifest =>
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
        transport: "network",
        operations: ["GetInvoice", "IssueRefund"],
        integrationPattern: "acl",
      },
    ],
  }) as unknown as Manifest;

describe("cross-context (network transport emitter)", () => {
  it("emits shared DTOs + controller (provider) & client (consumer) ports with REAL multi-method signatures + adapters", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const config = makeConfig(workspaceRoot, networkManifest(), {
        logger: createSpyLogger(),
      });

      const result = await generateCrossContext(config);
      assert.strictEqual(result.error, undefined, "emitter must not error");

      // 1. Shared DTOs — one file per operation, each exporting a Request + Response.
      const dto = path.join(
        workspaceRoot,
        "packages/shared/src/domain/dtos/GetInvoice.dto.ts",
      );
      assert.strictEqual(await pathExists(dto), true, "DTO file emitted");
      const dtoText = await readText(dto);
      assert.ok(dtoText.includes("export interface GetInvoiceRequest"));
      assert.ok(dtoText.includes("export interface GetInvoiceResponse"));
      assert.strictEqual(
        await pathExists(
          path.join(
            workspaceRoot,
            "packages/shared/src/domain/dtos/IssueRefund.dto.ts",
          ),
        ),
        true,
        "a DTO file per operation",
      );

      // 2. Provider (billing) controller IN-port — one real method per operation,
      //    NOT the generic stub.
      const ctrlPort = path.join(
        workspaceRoot,
        "packages/billing/src/application/ports/in/rest-controller.in-port.ts",
      );
      assert.strictEqual(
        await pathExists(ctrlPort),
        true,
        "controller port on the provider",
      );
      const ctrl = await readText(ctrlPort);
      assert.ok(ctrl.includes("export interface RestControllerPort"));
      assert.match(
        ctrl,
        /getInvoice\(request: GetInvoiceRequest\): Promise<GetInvoiceResponse>/,
        "controller has a real getInvoice(request): Promise<response> method",
      );
      assert.match(
        ctrl,
        /issueRefund\(request: IssueRefundRequest\): Promise<IssueRefundResponse>/,
        "controller has one method per operation",
      );
      assert.ok(
        !ctrl.includes("Define your port methods"),
        "must NOT be the generic inPort stub",
      );

      // 3. Consumer (orders) client OUT-port — the mirror methods.
      const clientPort = path.join(
        workspaceRoot,
        "packages/orders/src/application/ports/out/external-service-client.out-port.ts",
      );
      assert.strictEqual(
        await pathExists(clientPort),
        true,
        "client port on the consumer",
      );
      const client = await readText(clientPort);
      assert.ok(client.includes("export interface ExternalServiceClientPort"));
      assert.match(
        client,
        /getInvoice\(request: GetInvoiceRequest\): Promise<GetInvoiceResponse>/,
        "client mirrors the provider's operations",
      );

      // 4. Adapters — valid PascalCase class names; and because each network param
      //    is a SINGLE imported type (not a union), the analyzer preserves the real
      //    typed signature in the adapter (the event-bus union → `any` case doesn't
      //    apply here).
      const ctrlAdapter = await readText(
        path.join(
          workspaceRoot,
          "packages/billing/src/infrastructure/adapters/rest-controller.adapter.ts",
        ),
      );
      assert.match(
        ctrlAdapter,
        /export class RestControllerAdapter implements RestControllerPort/,
      );
      assert.match(
        ctrlAdapter,
        /getInvoice\(request: GetInvoiceRequest\): Promise<GetInvoiceResponse>/,
        "network adapter preserves the real typed signature",
      );
      const clientAdapter = await readText(
        path.join(
          workspaceRoot,
          "packages/orders/src/infrastructure/adapters/external-service-client.adapter.ts",
        ),
      );
      assert.match(
        clientAdapter,
        /export class ExternalServiceClientAdapter implements ExternalServiceClientPort/,
      );

      // 5. No event-bus transport leaks into a network template.
      assert.strictEqual(
        await pathExists(
          path.join(
            workspaceRoot,
            "packages/billing/src/application/ports/out/message-publisher.out-port.ts",
          ),
        ),
        false,
        "no event-bus publisher for a network edge",
      );
      assert.strictEqual(
        await pathExists(
          path.join(
            workspaceRoot,
            "packages/orders/src/application/ports/in/event-listener.in-port.ts",
          ),
        ),
        false,
        "no event-bus subscriber for a network edge",
      );
    });
  });

  it("camelCases a single-segment operation base (the useCases fallback shape)", async () => {
    // The wizard's E1 fallback resolves an undeclared-useCases provider to a single
    // provider-named operation (`Billing`); the emitter turns that into a `billing`
    // method + Billing{Request,Response} DTOs.
    const m = {
      system: "myorg",
      scope: "myorg",
      bounded_contexts: [{ name: "orders" }, { name: "billing" }],
      cross_context: [
        {
          consumer: "orders",
          provider: "billing",
          transport: "network",
          operations: ["Billing"],
          integrationPattern: "open-host",
        },
      ],
    } as unknown as Manifest;
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const config = makeConfig(workspaceRoot, m, {
        logger: createSpyLogger(),
      });
      await generateCrossContext(config);
      assert.strictEqual(
        await pathExists(
          path.join(
            workspaceRoot,
            "packages/shared/src/domain/dtos/Billing.dto.ts",
          ),
        ),
        true,
      );
      const ctrl = await readText(
        path.join(
          workspaceRoot,
          "packages/billing/src/application/ports/in/rest-controller.in-port.ts",
        ),
      );
      assert.match(
        ctrl,
        /billing\(request: BillingRequest\): Promise<BillingResponse>/,
      );
    });
  });
});

describe("cross-context — transport divergence (Decision A1 payoff)", () => {
  const contexts = [
    { name: "orders" },
    { name: "billing" },
    { name: "shared" },
  ];
  const edge = (transport: "event-bus" | "network") =>
    transport === "event-bus"
      ? {
          consumer: "orders",
          provider: "billing",
          transport,
          events: ["InvoiceIssued"],
          integrationPattern: "open-host",
        }
      : {
          consumer: "orders",
          provider: "billing",
          transport,
          operations: ["GetInvoice"],
          integrationPattern: "open-host",
        };
  const manifestFor = (transport: "event-bus" | "network"): Manifest =>
    ({
      system: "x",
      scope: "x",
      bounded_contexts: contexts,
      cross_context: [edge(transport)],
    }) as unknown as Manifest;

  const pub =
    "packages/billing/src/application/ports/out/message-publisher.out-port.ts";
  const ctrl =
    "packages/billing/src/application/ports/in/rest-controller.in-port.ts";

  it("event-bus emits a publisher and NO controller", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const config = makeConfig(workspaceRoot, manifestFor("event-bus"), {
        logger: createSpyLogger(),
      });
      await generateCrossContext(config);
      assert.strictEqual(
        await pathExists(path.join(workspaceRoot, pub)),
        true,
        "event-bus emits a publisher",
      );
      assert.strictEqual(
        await pathExists(path.join(workspaceRoot, ctrl)),
        false,
        "event-bus emits no network controller",
      );
    });
  });

  it("network emits a controller and NO publisher", async () => {
    await withTempWorkspace(async ({ workspaceRoot }) => {
      const config = makeConfig(workspaceRoot, manifestFor("network"), {
        logger: createSpyLogger(),
      });
      await generateCrossContext(config);
      assert.strictEqual(
        await pathExists(path.join(workspaceRoot, ctrl)),
        true,
        "network emits a controller",
      );
      assert.strictEqual(
        await pathExists(path.join(workspaceRoot, pub)),
        false,
        "network emits no event-bus publisher",
      );
    });
  });
});
