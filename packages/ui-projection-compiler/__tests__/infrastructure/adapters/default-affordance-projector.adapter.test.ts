import { DefaultAffordanceProjectorAdapter } from "../../../src/infrastructure/adapters/default-affordance-projector.adapter.js";
import type { Affordance } from "@hexagen/layout-engine";

describe("DefaultAffordanceProjectorAdapter", () => {
  const adapter = new DefaultAffordanceProjectorAdapter();

  const base: Affordance = {
    nodeId: "n1",
    movable: true,
    resizable: false,
    connectable: true,
    sides: ["north", "south"],
  };

  it("projects movable/resizable/connectable 1:1", () => {
    const projected = adapter.project(base);
    expect(projected.movable).toBe(true);
    expect(projected.resizable).toBe(false);
    expect(projected.connectable).toBe(true);
  });

  it("derives deletable: movable AND not resizable", () => {
    const projected = adapter.project(base);
    expect(projected.deletable).toBe(true);
  });

  it("marks a resizable affordance as not deletable", () => {
    const projected = adapter.project({ ...base, resizable: true });
    expect(projected.deletable).toBe(false);
  });

  it("marks a non-movable affordance as not deletable", () => {
    const projected = adapter.project({ ...base, movable: false });
    expect(projected.deletable).toBe(false);
  });
});
