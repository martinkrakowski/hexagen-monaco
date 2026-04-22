import { ResolveAffordanceUseCase } from "../src/application/use-cases/resolve-affordance.use-case.js";
import { FakeResolveAffordanceAdapter } from "./doubles/fake-resolve-affordance.ts";

describe("ResolveAffordanceUseCase", () => {
  let fake: FakeResolveAffordanceAdapter;
  let useCase: ResolveAffordanceUseCase;

  beforeEach(() => {
    fake = new FakeResolveAffordanceAdapter();
    useCase = new ResolveAffordanceUseCase(fake);
  });

  it("delegates to the resolver port", () => {
    useCase.execute("node-1", "bounded-context");
    expect(fake.callCount).toBe(1);
    expect(fake.lastNodeId).toBe("node-1");
    expect(fake.lastCategory).toBe("bounded-context");
  });

  it("returns default affordance with all sides", () => {
    const result = useCase.execute("node-1", "bounded-context");
    expect(result.nodeId).toBe("node-1");
    expect(result.movable).toBe(true);
    expect(result.sides).toContain("north");
    expect(result.sides).toContain("south");
    expect(result.sides).toContain("east");
    expect(result.sides).toContain("west");
  });

  it("returns forced affordance", () => {
    fake.forceAffordance({
      nodeId: "node-1",
      movable: false,
      resizable: false,
      connectable: false,
      sides: ["north"],
    });
    const result = useCase.execute("node-1", "entity");
    expect(result.movable).toBe(false);
    expect(result.sides).toEqual(["north"]);
  });
});
