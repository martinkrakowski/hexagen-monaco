import { DefaultIconResolverAdapter } from "../../../src/infrastructure/adapters/default-icon-resolver.adapter.js";

describe("DefaultIconResolverAdapter", () => {
  const adapter = new DefaultIconResolverAdapter();

  it("resolves aggregate to Package icon", () => {
    const mapping = adapter.resolve("aggregate");
    expect(mapping).not.toBeNull();
    expect(mapping?.lucideIcon).toBe("Package");
  });

  it("resolves valueObject to Gem icon", () => {
    const mapping = adapter.resolve("valueObject");
    expect(mapping?.lucideIcon).toBe("Gem");
  });

  it("resolves event to Zap icon", () => {
    const mapping = adapter.resolve("event");
    expect(mapping?.lucideIcon).toBe("Zap");
  });

  it("resolves service to Settings2 icon", () => {
    const mapping = adapter.resolve("service");
    expect(mapping?.lucideIcon).toBe("Settings2");
  });

  it("returns null for unknown logical name", () => {
    const mapping = adapter.resolve("unknown-icon");
    expect(mapping).toBeNull();
  });
});
