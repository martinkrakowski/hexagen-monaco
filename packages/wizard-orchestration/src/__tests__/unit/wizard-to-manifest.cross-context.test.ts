import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { ManifestSchema } from "@hexagen/project-configuration";
import { wizardToManifest } from "../../application/wizard-to-manifest";

// Phase 3: for a strict template, wizardToManifest derives cross-context
// transport from the peer mappings. event-bus (strict-enterprise): each edge
// (consumer → provider) makes the PROVIDER a publisher of its domain events and
// the CONSUMER a subscriber — the contract is the provider's events (Decision D1).
// network (micro-frontend): each edge carries the provider's `operations` (its
// use-cases, Decision E1) for the controller/client transport. In-process
// (modular-monolith) emits no transport. The dedicated generateCrossContext
// emitter is the sole writer of the files; these edges only describe them.

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
  events?: string[];
  operations?: string[];
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
  contexts: Array<{
    id: string;
    name: string;
    domainEvents?: string[];
    useCases?: string[];
  }>,
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
      useCases: c.useCases ?? [],
    })),
    peerMappings: peer.map((p) => ({
      consumerContext: p.consumerContext,
      providerContext: p.providerContext,
      integrationPattern: p.integrationPattern ?? "open-host",
      communicationBoundary: "networked",
    })),
  });

describe("wizardToManifest — Phase 3a cross-context (event-bus)", () => {
  it("emits a cross_context edge carrying the provider's events (no ports in layers)", () => {
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
    // Directionality (provider publishes) is captured in the edge: the provider
    // carries the event contracts. Transport ports/adapters are NOT injected into
    // the manifest layers — the dedicated generateCrossContext emitter is their
    // sole writer (it would otherwise be clobbered by generateStubs under the web
    // flow's forceRoot; see packages/sync cross-context.test.ts).
    assert.ok(
      !outPorts(bc(m, "billing")).includes("message-publisher.out-port.ts"),
    );
    assert.ok(
      !adapters(bc(m, "billing")).includes("message-publisher.adapter.ts"),
    );
    assert.ok(!inPorts(bc(m, "orders")).includes("event-listener.in-port.ts"));
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

  it("emits an edge per consumer for a shared provider (emitter dedupes the publisher file)", () => {
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
    // Both edges present at the manifest level (the emitter dedupes the
    // provider's single publisher file from them).
    assert.equal(edges(m).length, 2);
    assert.ok(edges(m).every((e) => e.provider === "billing"));
    assert.ok(
      !outPorts(bc(m, "billing")).includes("message-publisher.out-port.ts"),
    );
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

  it("micro-frontend (network) emits a network edge carrying the provider's use-cases (Decision E1)", () => {
    const m = wizardToManifest(
      wizard(
        "micro-frontend",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "billing", useCases: ["GetInvoice", "IssueRefund"] },
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    assert.deepEqual(edges(m), [
      {
        consumer: "orders",
        provider: "billing",
        transport: "network",
        operations: ["GetInvoice", "IssueRefund"],
        integrationPattern: "open-host",
      },
    ]);
    // As with event-bus, the transport ports/adapters are NOT injected into the
    // layers — the dedicated emitter is their sole writer.
    assert.ok(
      !inPorts(bc(m, "billing")).includes("rest-controller.in-port.ts"),
    );
    assert.ok(
      !outPorts(bc(m, "orders")).includes(
        "external-service-client.out-port.ts",
      ),
    );
  });

  it("network falls back to the provider context name when no useCases are declared", () => {
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
    assert.equal(edges(m)[0].transport, "network");
    assert.deepEqual(edges(m)[0].operations, ["Billing"]);
  });

  it("network PascalCases and dedupes the provider's useCases", () => {
    const m = wizardToManifest(
      wizard(
        "micro-frontend",
        [
          { id: "o", name: "orders" },
          {
            id: "b",
            name: "billing",
            useCases: ["get invoice", "get-invoice", "issue refund"],
          },
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    // "get invoice" and "get-invoice" both PascalCase to GetInvoice → deduped,
    // declared order preserved.
    assert.deepEqual(edges(m)[0].operations, ["GetInvoice", "IssueRefund"]);
  });

  it("the same contexts diverge by template: event-bus vs network (Decision A1)", () => {
    const contexts = [
      { id: "o", name: "orders" },
      {
        id: "b",
        name: "billing",
        domainEvents: ["InvoiceIssued"],
        useCases: ["GetInvoice"],
      },
    ];
    const peer = [{ consumerContext: "o", providerContext: "b" }];
    const strict = wizardToManifest(
      wizard("strict-enterprise", contexts, peer),
    );
    const micro = wizardToManifest(wizard("micro-frontend", contexts, peer));

    assert.equal(edges(strict)[0].transport, "event-bus");
    assert.deepEqual(edges(strict)[0].events, ["InvoiceIssued"]);
    assert.equal(edges(strict)[0].operations, undefined);

    assert.equal(edges(micro)[0].transport, "network");
    assert.deepEqual(edges(micro)[0].operations, ["GetInvoice"]);
    assert.equal(edges(micro)[0].events, undefined);
  });
});

// The arch-linter loads .architecture/manifest.yaml through the manifest schema.
// Before Phase 3c that schema (.strict()) rejected `workspaceTemplate` (leaked
// since Phase 1) and `cross_context` (Phase 3a) as unrecognized keys, so the
// linter FATALed on every wizard-generated project. Pin that the wizard's own
// output is schema-valid so this can't regress.
describe("wizardToManifest — output is valid against the manifest schema", () => {
  it("a strict-enterprise manifest (workspaceTemplate + event-bus cross_context) passes ManifestSchema", () => {
    const m = wizardToManifest(
      wizard(
        "strict-enterprise",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "billing", domainEvents: ["InvoiceIssued"] },
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    const result = ManifestSchema.safeParse(m);
    assert.ok(
      result.success,
      `manifest must satisfy ManifestSchema (the arch-linter's loader); issues: ${
        result.success ? "" : JSON.stringify(result.error.issues)
      }`,
    );
  });

  it("a micro-frontend manifest (network cross_context) passes ManifestSchema", () => {
    const m = wizardToManifest(
      wizard(
        "micro-frontend",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "billing", useCases: ["GetInvoice"] },
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    assert.ok(ManifestSchema.safeParse(m).success);
  });

  it("a modular-monolith manifest (no cross_context) passes ManifestSchema", () => {
    const m = wizardToManifest(
      wizard(
        "modular-monolith",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "billing" },
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    assert.ok(ManifestSchema.safeParse(m).success);
  });
});

// toPascalCase feeds generated contract/symbol names; bounded-context names and
// domainEvents/useCases are unconstrained strings, so a digit-leading value would
// otherwise become an invalid TS identifier (e.g. "123-billing" -> "123Billing").
// The function prefixes such names so the emitted declarations compile.
const isValidTsIdentifier = (s: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);

describe("wizardToManifest — contract names are valid TS identifiers", () => {
  it("prefixes a digit-leading domainEvent so the event contract compiles", () => {
    const m = wizardToManifest(
      wizard(
        "strict-enterprise",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "billing", domainEvents: ["123-billing"] },
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    assert.deepEqual(edges(m)[0].events, ["Context123Billing"]);
    assert.ok(edges(m)[0].events!.every(isValidTsIdentifier));
  });

  it("keeps the <Provider>Event fallback a valid identifier for a digit-leading context name", () => {
    const m = wizardToManifest(
      wizard(
        "strict-enterprise",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "3pl" }, // digit-leading context, no domainEvents
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    // "3pl" -> "Context3pl" -> fallback "Context3plEvent" (valid), not "3plEvent".
    assert.deepEqual(edges(m)[0].events, ["Context3plEvent"]);
    assert.ok(edges(m)[0].events!.every(isValidTsIdentifier));
  });

  it("prefixes a digit-leading useCase so the network operation/DTO names compile", () => {
    const m = wizardToManifest(
      wizard(
        "micro-frontend",
        [
          { id: "o", name: "orders" },
          { id: "b", name: "billing", useCases: ["123-process"] },
        ],
        [{ consumerContext: "o", providerContext: "b" }],
      ),
    );
    assert.deepEqual(edges(m)[0].operations, ["Context123Process"]);
    assert.ok(edges(m)[0].operations!.every(isValidTsIdentifier));
  });
});
