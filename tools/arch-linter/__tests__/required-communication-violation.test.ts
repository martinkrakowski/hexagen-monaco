import { describe, it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import {
  checkRequiredCommunication,
  type CrossContextEdgeInput,
} from "../src/required-communication-violation.js";

const PKG = path.join("/ws", "packages");

/** A fileExists predicate that returns true only for the given package-relative paths. */
const exists =
  (presentRelPaths: string[]) =>
  (absPath: string): boolean =>
    presentRelPaths.map((r) => path.join(PKG, r)).includes(absPath);

const EVENT_BUS_PORTS = [
  "billing/src/application/ports/out/message-publisher.out-port.ts", // provider publisher
  "orders/src/application/ports/in/event-listener.in-port.ts", // consumer subscriber
];
const NETWORK_PORTS = [
  "billing/src/application/ports/in/rest-controller.in-port.ts", // provider controller
  "orders/src/application/ports/out/external-service-client.out-port.ts", // consumer client
];

const eventBusEdge: CrossContextEdgeInput = {
  consumer: "orders",
  provider: "billing",
  transport: "event-bus",
};
const networkEdge: CrossContextEdgeInput = {
  consumer: "orders",
  provider: "billing",
  transport: "network",
};

describe("checkRequiredCommunication — positive cross-context enforcement", () => {
  it("event-bus: no violation when both transport ports exist", () => {
    const v = checkRequiredCommunication(
      [eventBusEdge],
      PKG,
      exists(EVENT_BUS_PORTS),
    );
    assert.deepEqual(v, []);
  });

  it("event-bus: flags the provider's missing publisher port", () => {
    const v = checkRequiredCommunication(
      [eventBusEdge],
      PKG,
      exists([EVENT_BUS_PORTS[1]]), // subscriber present, publisher missing
    );
    assert.equal(v.length, 1);
    assert.equal(v[0].provider, "billing");
    assert.equal(v[0].transport, "event-bus");
    assert.match(v[0].missingPort, /message-publisher\.out-port\.ts$/);
    assert.match(v[0].message, /publisher/);
  });

  it("event-bus: flags the consumer's missing subscriber port", () => {
    const v = checkRequiredCommunication(
      [eventBusEdge],
      PKG,
      exists([EVENT_BUS_PORTS[0]]), // publisher present, subscriber missing
    );
    assert.equal(v.length, 1);
    assert.match(v[0].missingPort, /orders\/.*event-listener\.in-port\.ts$/);
  });

  it("event-bus: flags both ports when the transport is entirely absent (a transport-less strict project fails)", () => {
    const v = checkRequiredCommunication([eventBusEdge], PKG, exists([]));
    assert.equal(v.length, 2);
    assert.ok(v.every((x) => x.enforcement === "error"));
  });

  it("network: no violation when controller + client exist", () => {
    const v = checkRequiredCommunication(
      [networkEdge],
      PKG,
      exists(NETWORK_PORTS),
    );
    assert.deepEqual(v, []);
  });

  it("network: flags the provider's missing controller port", () => {
    const v = checkRequiredCommunication(
      [networkEdge],
      PKG,
      exists([NETWORK_PORTS[1]]), // client present, controller missing
    );
    assert.equal(v.length, 1);
    assert.match(v[0].missingPort, /rest-controller\.in-port\.ts$/);
  });

  it("network: flags the consumer's missing client port", () => {
    const v = checkRequiredCommunication(
      [networkEdge],
      PKG,
      exists([NETWORK_PORTS[0]]), // controller present, client missing
    );
    assert.equal(v.length, 1);
    assert.match(v[0].missingPort, /external-service-client\.out-port\.ts$/);
  });

  it("returns nothing for an in-process project (no edges)", () => {
    assert.deepEqual(
      checkRequiredCommunication(undefined, PKG, exists([])),
      [],
    );
    assert.deepEqual(checkRequiredCommunication([], PKG, exists([])), []);
  });

  it("skips malformed edges (missing consumer/provider/transport)", () => {
    const v = checkRequiredCommunication(
      [
        { provider: "billing", transport: "event-bus" }, // no consumer
        { consumer: "orders", transport: "event-bus" }, // no provider
        { consumer: "orders", provider: "billing" }, // no transport
      ],
      PKG,
      exists([]),
    );
    assert.deepEqual(v, []);
  });

  it("ignores unknown transports (nothing to enforce)", () => {
    const v = checkRequiredCommunication(
      [
        {
          consumer: "orders",
          provider: "billing",
          transport: "carrier-pigeon",
        },
      ],
      PKG,
      exists([]),
    );
    assert.deepEqual(v, []);
  });

  it("enforces per edge across multiple providers", () => {
    const v = checkRequiredCommunication(
      [
        eventBusEdge, // orders -> billing, both present
        { consumer: "orders", provider: "shipping", transport: "event-bus" }, // shipping missing
      ],
      PKG,
      exists(EVENT_BUS_PORTS), // only billing/orders ports present
    );
    // shipping publisher missing + the (already-present) orders subscriber is
    // shared, so only the shipping publisher is flagged.
    assert.equal(v.length, 1);
    assert.equal(v[0].provider, "shipping");
  });

  it("flags an unsafe context name and never probes outside packages/ (manifest path traversal)", () => {
    const root = path.resolve(PKG);
    let probedOutside = false;
    const fe = (p: string): boolean => {
      if (p !== root && !p.startsWith(root + path.sep)) probedOutside = true;
      return true; // pretend everything exists, to prove we never even ask outside
    };
    const v = checkRequiredCommunication(
      [{ consumer: "orders", provider: "../../evil", transport: "event-bus" }],
      PKG,
      fe,
    );
    assert.ok(
      v.some((x) => /unsafe context name|outside packages/.test(x.message)),
      "the traversing context name is flagged",
    );
    assert.strictEqual(
      probedOutside,
      false,
      "the check never stats a path resolved outside packages/",
    );
  });

  // `missingPort` is both shown to a human and used verbatim as the file half of
  // the ratchet-baseline key, so a hard-coded `packages/` prefix would name a
  // path that does not exist in a project whose workspaces are `modules/*` —
  // an unfixable baseline entry and a message that sends the reader nowhere.
  it("reports the project's real workspace directory, not a hard-coded packages/", () => {
    const modules = path.join("/ws", "modules");
    const v = checkRequiredCommunication([eventBusEdge], modules, () => false);
    assert.ok(v.length > 0, "missing ports are still flagged");
    for (const x of v) {
      assert.ok(
        x.missingPort.startsWith("modules/"),
        `missingPort should be workspace-relative: ${x.missingPort}`,
      );
      assert.doesNotMatch(x.missingPort, /packages\//);
      assert.match(x.message, /missing at modules\//);
    }
  });

  it("keeps the conventional packages/ prefix when that IS the workspace dir", () => {
    const v = checkRequiredCommunication([eventBusEdge], PKG, () => false);
    assert.ok(v.length > 0);
    for (const x of v) {
      assert.ok(
        x.missingPort.startsWith("packages/"),
        `missingPort should be workspace-relative: ${x.missingPort}`,
      );
    }
  });
});
