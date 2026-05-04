import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBoundaryViolatedEvent } from "../../../src/domain/events/boundary-violated.event";
import { createDependencyAddedEvent } from "../../../src/domain/events/dependency-added.event";
import { createModuleScaffoldedEvent } from "../../../src/domain/events/module-scaffolded.event";
import { InMemoryEventBusAdapter } from "../../../src/infrastructure/adapters/in-memory-event-bus.adapter";

describe("Architectural events event-bus compatibility", () => {
  it("should deliver all published events to subscribers", () => {
    const eventBus = new InMemoryEventBusAdapter();
    const receivedTypes: string[] = [];

    eventBus.subscribe("BoundaryViolated", (event) => {
      receivedTypes.push(event.type);
    });
    eventBus.subscribe("DependencyAdded", (event) => {
      receivedTypes.push(event.type);
    });
    eventBus.subscribe("ModuleScaffolded", (event) => {
      receivedTypes.push(event.type);
    });

    eventBus.publish(
      createBoundaryViolatedEvent(
        {
          ruleId: "no-infrastructure-in-domain",
          severity: "error",
          file: "packages/sync/src/domain/example.ts",
          message: "Domain import boundary violated",
        },
        "messaging-test",
      ),
    );

    eventBus.publish(
      createDependencyAddedEvent(
        {
          source: "project-configuration",
          target: "sync",
          relationship: "depends_on",
        },
        "messaging-test",
      ),
    );

    eventBus.publish(
      createModuleScaffoldedEvent(
        {
          moduleName: "mcp-server",
          layer: "infrastructure",
        },
        "messaging-test",
      ),
    );

    assert.deepStrictEqual(receivedTypes, [
      "BoundaryViolated",
      "DependencyAdded",
      "ModuleScaffolded",
    ]);
  });
});
