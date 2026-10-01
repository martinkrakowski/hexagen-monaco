import { describe, it, expect } from "vitest";
import { projectMode } from "@hexagen/shared";
import { parseSavedProjectBody } from "../saved-project-body";
import type { SavedProject as AppSavedProject } from "../../../app/hooks/useSavedProjects";

const row = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "p",
  schemaVersion: 4,
  createdAt: 1,
  updatedAt: 2,
  formState: {},
  manifestYaml: "",
};

describe("savedProjectBodySchema mode", () => {
  it("loads a row without mode unchanged, and it reads as greenfield", () => {
    const r = parseSavedProjectBody(row);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project).toEqual(row);
    expect("mode" in r.project).toBe(false);
    expect(projectMode(r.project)).toBe("greenfield");
  });

  it("keeps an explicit brownfield mode", () => {
    const r = parseSavedProjectBody({ ...row, mode: "brownfield" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(projectMode(r.project)).toBe("brownfield");
  });

  it("keeps an explicit greenfield mode", () => {
    const r = parseSavedProjectBody({ ...row, mode: "greenfield" });
    expect(r.ok).toBe(true);
  });

  it("refuses an unknown mode rather than passing it through", () => {
    expect(parseSavedProjectBody({ ...row, mode: "hybrid" }).ok).toBe(false);
  });
});

describe("app-level SavedProject narrowing", () => {
  it("carries the optional mode field", () => {
    const mode: AppSavedProject["mode"] = "brownfield";
    expect(mode).toBe("brownfield");
  });
});
