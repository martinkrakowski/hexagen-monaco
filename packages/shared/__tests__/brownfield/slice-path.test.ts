import { describe, it, expect } from "vitest";
import {
  normalizeSlicePath,
  isPathInSlice,
  type Slice,
} from "../../src/types/brownfield/index";

const slice = (paths: string[], excludes: string[] = []): Slice => ({
  schemaVersion: "1.0.0",
  id: "s1",
  repo: { commit: "abc1234" },
  paths,
  excludes,
  createdBy: "fde",
  createdAt: "2026-10-01T00:00:00.000Z",
});

describe("normalizeSlicePath", () => {
  it.each([
    "packages/bill/",
    "packages/bill/index.ts",
    ".hexagen/",
    "a/.../b",
    "README.md",
  ])("accepts %s unchanged", (p) => {
    expect(normalizeSlicePath(p)).toEqual({ ok: true, path: p });
  });

  it.each([
    ["", "empty"],
    [".", "dot segment"],
    ["..", "dotdot segment"],
    ["a/./b", "dot segment"],
    ["a/../b", "dotdot segment"],
    ["packages/bill/../../outside", "dotdot segment"],
    ["./a", "dot segment"],
    ["a/..", "dotdot segment"],
    ["/etc/passwd", "absolute"],
    ["C:/x", "absolute"],
    ["a\\b", "backslash"],
    ["a\0b", "NUL"],
    ["a//b", "empty segment"],
  ])("refuses %j (%s)", (p) => {
    expect(normalizeSlicePath(p).ok).toBe(false);
  });
});

describe("isPathInSlice", () => {
  it("a trailing slash is a directory prefix", () => {
    const s = slice(["packages/bill/"]);
    expect(isPathInSlice(s, "packages/bill/x.ts")).toBe(true);
    expect(isPathInSlice(s, "packages/billing/x.ts")).toBe(false);
  });
  it("anything else is an exact path", () => {
    const s = slice(["packages/bill"]);
    expect(isPathInSlice(s, "packages/bill")).toBe(true);
    expect(isPathInSlice(s, "packages/bill/x.ts")).toBe(false);
    expect(isPathInSlice(s, "packages/billing")).toBe(false);
  });
  it("is case-sensitive", () => {
    expect(isPathInSlice(slice(["Src/"]), "src/a.ts")).toBe(false);
    expect(isPathInSlice(slice(["Src/"]), "Src/a.ts")).toBe(true);
  });
  it("excludes win over paths", () => {
    const s = slice(["src/"], ["src/gen/"]);
    expect(isPathInSlice(s, "src/a.ts")).toBe(true);
    expect(isPathInSlice(s, "src/gen/a.ts")).toBe(false);
  });
  it("denies everything outside paths", () => {
    expect(isPathInSlice(slice(["src/"]), "lib/a.ts")).toBe(false);
    expect(isPathInSlice(slice([]), "src/a.ts")).toBe(false);
  });
  it("refuses an invalid candidate path before matching", () => {
    const s = slice(["packages/bill/"]);
    expect(isPathInSlice(s, "packages/bill/../../outside")).toBe(false);
    expect(isPathInSlice(s, "/packages/bill/x")).toBe(false);
    expect(isPathInSlice(s, "packages/bill/a\\b")).toBe(false);
    expect(isPathInSlice(s, "packages/bill/a\0")).toBe(false);
  });
});
