import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { wizardToManifest } from "../../application/wizard-to-manifest";

// Phase 3a: for an event-bus template, wizardToManifest derives cross-context
// transport from the peer mappings. Each edge (consumer → provider) makes the
// PROVIDER a publisher of its domain events (message-publisher out-port +
// adapter) and the CONSUMER a subscriber (event-listener in-port + adapter) —
// the contract is the provider's events (Decision D1), so the provider publishes.
// In-process (modular-monolith) emits no transport. Network is Phase 3b.

const asWizard = (x: unknown) =>
  x as unknown as Parameters<typeof wizardToManifest>[0];

interface BC {
  name: string;
  layers?: {
    application?: { ports?: { in?: string[]; out?: string[] } };
    infrastructure?: { adapters?: string[] };
  };
}
interface Edge {
  consumer: string;
  provider: string;
  transport: string;
  events: string[];
  integrationPattern: string;
}

const bc = (manifest: Record<string, unknown>, name: string): BC => {
  const found = (manifest.bounded_contexts as BC[]).find(
    (c) => c.name === name,
  );
  assert.ok(found, `expected a bounded context named "${name}"`);
  return found;
};
const edges = (manifest: Record<string, unknown>): Edge[] =>
  (manifest.cross_context as Edge[]) ?? [];
const inPorts = (b: BC): string[] => b.layers?.application?.ports?.in ?? [];
const outPorts = (b: BC): string[] => b.layers?.application?.ports?.out ?? [];
const adapters = (b: BC): string[] => b.layers?.infrastructure?.adapters ?? [];

const wizard = (
  template: string,
  contexts: Array<{ id: string; name: string; domainEvents?: string[] }>,
  peer: Array<{
    consumerContext: string;
    providerContext: string;
    integrationPattern?: string;
  }>,
) =>
  asWizard({
    governance: {
      workspaceName: "demo",
      namespacePrefix: "@demo",
      packageManager: "yarn",
      workspaceTemplate: template,
    },
    boundedContexts: contexts.map((c) => ({
      id: c.id,
      name: c.name,
      domainEvents: c.domainEvents ?? [],
    })),
    peerMappings: peer.map((p) => ({
      consumerContext: p.consumerContext,
      providerContext: p.providerContext,
      integrationPattern: p.integrationPattern ?? "open-host",
      communicationBoundary: "networked",
    })),
  });

describe("wizardToManifest — Phase 3a cross-context (event-bus)", () => {
  it("provider publishes its domainEvents; consumer subscribes", () => {
    const m = wizardToManifest(
      wizard(
        "strict-enterprise",
        [
          { id: "orders-id", name: "orders" },
          {
            id: "billing-id",
            name: "billing",
            domainEvents: ["InvoiceIssued", "PaymentReceived"],
          },
        ],
        [{ consumerContext: "orders-id", providerContext: "billing-id" }],
      ),
    );

    assert.deepEqual(edges(m), [
      {
        consumer: "orders",
        provider: "billing",
        transport: "event-bus",
        events: ["InvoiceIssued", "PaymentReceived"],
        integrationPattern: "open-host",
      },
    ]);
    // provider = publisher
    assert.ok(
      outPorts(bc(m, "billing")).includes("message-publisher.out-port.ts"),
    );
    assert.ok(
      adapters(bc(m, "billing")).includes("message-publisher.adapter.ts"),
    );
    // consumer = subscriber
    assert.ok(inPorts(bc(m, "orders")).includes("event-listener.in-port.ts"));
    assert.ok(adapters(bc(m, "orders")).includes("event-listener.adapter.ts"));
    // directionality: the consumer is NOT a publisher
    assert.ok(
      !outPorts(bc(m, "orders")).includes("message-publisher.out-port.ts"),
    );
  });

  it("falls back to <Provider>Event when the provider declares no domainEvents", () => {
    const m = wizardToManifest(
      wizard(
        "strict-enterprise",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "billing" },
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    assert.deepEqual(edges(m)[0].events, ["BillingEvent"]);
  });

  it("carries the integrationPattern (acl)", () => {
    const m = wizardToManifest(
      wizard(
        "strict-enterprise",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "billing" },
        ],
        [
          {
            consumerContext: "o",
            providerContext: "b",
            integrationPattern: "acl",
          },
        ],
      ),
    );
    assert.equal(edges(m)[0].integrationPattern, "acl");
  });

  it("dedupes the publisher port when one provider serves multiple consumers", () => {
    const m = wizardToManifest(
      wizard(
        "strict-enterprise",
        [
          { id: "o", name: "orders" },
          { id: "s", name: "shipping" },
          { id: "b", name: "billing", domainEvents: ["InvoiceIssued"] },
        ],
        [
          { consumerContext: "o", providerContext: "b" },
          { consumerContext: "s", providerContext: "b" },
        ],
      ),
    );
    const pub = outPorts(bc(m, "billing")).filter(
      (p) => p === "message-publisher.out-port.ts",
    );
    assert.equal(
      pub.length,
      1,
      "one publisher port on the provider across edges",
    );
    assert.equal(edges(m).length, 2);
  });

  it("modular-monolith (in-process) emits no cross_context and no transport ports", () => {
    const m = wizardToManifest(
      wizard(
        "modular-monolith",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "billing", domainEvents: ["InvoiceIssued"] },
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    assert.equal(
      m.cross_context,
      undefined,
      "no cross_context key for in-process",
    );
    assert.ok(
      !outPorts(bc(m, "billing")).includes("message-publisher.out-port.ts"),
    );
    assert.ok(!inPorts(bc(m, "orders")).includes("event-listener.in-port.ts"));
  });

  it("micro-frontend (network) emits no event-bus transport (deferred to 3b)", () => {
    const m = wizardToManifest(
      wizard(
        "micro-frontend",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "billing" },
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    assert.equal(m.cross_context, undefined);
  });
});
