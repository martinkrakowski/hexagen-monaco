import { describe, it, expect } from "vitest";
import { projectMode, type SavedProject } from "../../src/domain/saved-project";

const base: SavedProject = {
  id: "00000000-0000-4000-8000-000000000000",
  name: "p",
  schemaVersion: 4,
  createdAt: 1,
  updatedAt: 1,
  formState: {},
  manifestYaml: "",
};

describe("projectMode", () => {
  it("defaults an absent mode to greenfield", () => {
    expect(projectMode(base)).toBe("greenfield");
  });
  it("returns brownfield when set", () => {
    expect(projectMode({ ...base, mode: "brownfield" })).toBe("brownfield");
  });
  it("returns greenfield when set", () => {
    expect(projectMode({ ...base, mode: "greenfield" })).toBe("greenfield");
  });
  it("treats an unrecognised stored value as greenfield", () => {
    expect(projectMode({ ...base, mode: "x" as never })).toBe("greenfield");
  });
});
