import assert from "node:assert";
import { FakeOwnershipRegistryPort } from "../../doubles/ports/ownership-registry.fake.js";

// Test default empty map
(async () => {
  const fake = new FakeOwnershipRegistryPort();
  const map = await fake.loadOwnershipMap();
  assert.deepStrictEqual(
    map,
    { success: true, value: [] },
    "Default map should be empty",
  );
})();

// Test setting a custom map
(async () => {
  const fake = new FakeOwnershipRegistryPort();
  const customMap = [
    { portName: "PortA", owningPackage: "PackageA" },
    { portName: "PortB", owningPackage: "PackageB" },
  ];
  fake.setOwnershipMap(customMap);
  const map = await fake.loadOwnershipMap();
  assert.deepStrictEqual(
    map,
    { success: true, value: customMap },
    "Custom map should be returned",
  );
})();

// Test successful registration of a new port
(async () => {
  const fake = new FakeOwnershipRegistryPort();
  const result = await fake.registerPortOwnership("NewPort", "PackageC");
  assert.deepStrictEqual(
    result,
    { success: true, value: undefined },
    "Registration should succeed",
  );
  const map = await fake.loadOwnershipMap();
  assert.deepStrictEqual(
    map,
    {
      success: true,
      value: [{ portName: "NewPort", owningPackage: "PackageC" }],
    },
    "Map should contain the new registration",
  );
})();

// Test registration conflict (different owning package)
(async () => {
  const fake = new FakeOwnershipRegistryPort();
  await fake.registerPortOwnership("SharedPort", "PackageX");
  const conflict = await fake.registerPortOwnership("SharedPort", "PackageY");
  assert.strictEqual(conflict.success, false, "Conflict should fail");
  assert.ok(conflict.error instanceof Error, "Error should be present");
  const map = await fake.loadOwnershipMap();
  assert.deepStrictEqual(
    map,
    {
      success: true,
      value: [{ portName: "SharedPort", owningPackage: "PackageX" }],
    },
    "Map should remain unchanged after conflict",
  );
})();

// Test canDeclarePort logic
(async () => {
  const fake = new FakeOwnershipRegistryPort();
  await fake.registerPortOwnership("PortC", "PackageC");
  const canDeclareSame = await fake.canDeclarePort("PortC", "PackageC");
  const canDeclareOther = await fake.canDeclarePort("PortC", "PackageD");
  assert.strictEqual(canDeclareSame, true, "Same package should be allowed");
  assert.strictEqual(
    canDeclareOther,
    false,
    "Different package should be denied",
  );
})();

// Test getOwningPackage lookup
(async () => {
  const fake = new FakeOwnershipRegistryPort();
  await fake.registerPortOwnership("PortD", "PackageD");
  const owner = await fake.getOwningPackage("PortD");
  const missing = await fake.getOwningPackage("NonExistent");
  assert.strictEqual(
    owner,
    "PackageD",
    "Should return the correct owning package",
  );
  assert.strictEqual(missing, null, "Should return null for unknown ports");
})();

console.log("All FakeOwnershipRegistryPort tests passed.");
