import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { PersistenceDomainRegistry } from "../../src/infrastructure/persistence-domain-registry.js";

/**
 * HEX-023 (plan item 4.2): `getActiveBackend` was dead — zero callers anywhere
 * in the repo — yet it sat on both the `PersistenceDomainRegistryPort` interface
 * and this implementation. It was deleted. These tests lock the live surface in
 * place and fail if the dead method is reintroduced onto the port.
 */
describe("PersistenceDomainRegistry surface (item 4.2)", () => {
  it("no longer exposes the dead getActiveBackend method", () => {
    const registry = new PersistenceDomainRegistry();
    assert.ok(
      !("getActiveBackend" in registry),
      "getActiveBackend must not exist on the registry (dead API removed, HEX-023)",
    );
  });

  it("still exposes the live registry methods", () => {
    const registry = new PersistenceDomainRegistry();
    assert.equal(typeof registry.markMigrated, "function");
    assert.equal(typeof registry.isMigrated, "function");
    assert.equal(typeof registry.getAllDomains, "function");
    assert.ok(
      registry.getAllDomains().length > 0,
      "getAllDomains still enumerates the persistence domains",
    );
  });
});
