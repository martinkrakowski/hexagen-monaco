import { DefaultAffordanceCompatibilityAdapter } from "../../../src/infrastructure/adapters/default-affordance-compatibility.adapter.js";
import type { Affordance } from "@hexagen/layout-engine";

describe("DefaultAffordanceCompatibilityAdapter", () => {
  const adapter = new DefaultAffordanceCompatibilityAdapter();

  it("accepts a compatible affordance", () => {
    const affordance: Affordance = {
      nodeId: "n1",
      movable: true,
      resizable: false,
      connectable: true,
      sides: ["north"],
    };
    const result = adapter.check(affordance);
    expect(result.realizable).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects connectable with no sides exposed", () => {
    const affordance: Affordance = {
      nodeId: "n1",
      movable: true,
      resizable: false,
      connectable: true,
      sides: [],
    };
    const result = adapter.check(affordance);
    expect(result.realizable).toBe(false);
    expect(result.errors[0]?.type).toBe("incompatible-affordance");
  });

  it("warns on resizable without movable", () => {
    const affordance: Affordance = {
      nodeId: "n1",
      movable: false,
      resizable: true,
      connectable: true,
      sides: ["north"],
    };
    const result = adapter.check(affordance);
    expect(result.realizable).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});
