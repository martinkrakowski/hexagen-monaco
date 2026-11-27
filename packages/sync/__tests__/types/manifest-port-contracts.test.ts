import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  CodecGeneratorConfig,
  GeneratorConfig,
  PortContract,
  PortContractField,
  PortDefinition,
} from "../../src/types/manifest/index.js";

describe("manifest port-contract TypeScript types", () => {
  it("accepts PortDefinition with and without contracts and GeneratorConfig with codec.runtimeModule", () => {
    // Without contracts — plain ports remain valid.
    const plain: PortDefinition = { name: "PlainPort" };
    const owned: PortDefinition = { name: "OwnedPort", owner: "team-a" };
    assert.equal(plain.contracts, undefined);
    assert.equal(owned.owner, "team-a");

    // With contracts — the typed request shape.
    const request: PortContractField = {
      kind: "object",
      exact: true,
      fields: {
        id: { kind: "integer", min: 0 },
        name: { kind: "string", maxLength: 32 },
        tags: { kind: "array", items: { kind: "string", maxLength: 8 }, maxItems: 10 },
        flag: { kind: "boolean" },
        role: { kind: "enum", values: ["admin", "member"] },
        mode: { kind: "literal", value: "fixed" },
        note: { kind: "nullable", of: { kind: "string", maxLength: 16 } },
        maybeOwner: { optional: { kind: "string", maxLength: 32 } },
      },
    };
    const contracts: PortContract = { request };
    const typed: PortDefinition = { name: "TypedPort", contracts };
    assert.deepEqual(typed.contracts, { request });

    // generator.codec.runtimeModule.
    const codec: CodecGeneratorConfig = { runtimeModule: "@fleet/shared" };
    const generator: GeneratorConfig = { name: "x", codec };
    assert.equal(generator.codec?.runtimeModule, "@fleet/shared");
    const legacy: GeneratorConfig = { name: "legacy" };
    assert.equal(legacy.codec, undefined);
  });
});
