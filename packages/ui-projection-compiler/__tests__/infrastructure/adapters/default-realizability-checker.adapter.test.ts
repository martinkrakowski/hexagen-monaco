import { DefaultRealizabilityCheckerAdapter } from "../../../src/infrastructure/adapters/default-realizability-checker.adapter.js";
import type { NodeVisualSpec } from "@hexagen/core-domain";
import { NodeKind } from "@hexagen/core-domain";

describe("DefaultRealizabilityCheckerAdapter", () => {
  const adapter = new DefaultRealizabilityCheckerAdapter();

  it("accepts a valid NodeVisualSpec", () => {
    const spec: NodeVisualSpec = {
      nodeId: "node-1",
      kind: NodeKind.Entity,
      label: "User",
    };
    const result = adapter.check(spec);
    expect(result.realizable).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects an empty nodeId", () => {
    const spec = {
      nodeId: "",
      kind: NodeKind.Entity,
      label: "User",
    } as NodeVisualSpec;
    const result = adapter.check(spec);
    expect(result.realizable).toBe(false);
    expect(result.errors[0]?.type).toBe("unrealizable-projection");
  });

  it("rejects a non-string nodeId", () => {
    const spec = {
      nodeId: null as unknown as string,
      kind: NodeKind.Entity,
      label: "User",
    } as NodeVisualSpec;
    const result = adapter.check(spec);
    expect(result.realizable).toBe(false);
  });

  it("rejects a spec without kind", () => {
    const spec = { nodeId: "node-1", label: "User" } as NodeVisualSpec;
    const result = adapter.check(spec);
    expect(result.realizable).toBe(false);
  });
});
