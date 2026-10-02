import { describe, expect, it } from "vitest";
import {
  isSameOrInside,
  samePath,
} from "../../../src/commands/observe/same-path.js";

describe("samePath", () => {
  it("treats forward-slash and backslash forms of one path as equal", () => {
    expect(
      samePath("C:/Users/x/Temp/a", "C:\\Users\\x\\Temp\\a", "win32"),
    ).toBe(true);
    expect(
      samePath("C:/Users/x/Temp/a", "C:\\Users\\x\\Temp\\a", "linux"),
    ).toBe(true);
  });

  it("ignores case only under win32", () => {
    expect(samePath("C:/Users/X/temp", "c:/users/x/Temp", "win32")).toBe(true);
    expect(samePath("/Users/X/temp", "/users/x/Temp", "linux")).toBe(false);
    expect(samePath("/Users/X/temp", "/users/x/Temp", "darwin")).toBe(false);
  });

  it("ignores a trailing separator", () => {
    expect(samePath("C:\\a\\b\\", "C:/a/b", "win32")).toBe(true);
    expect(samePath("/a/b/", "/a/b", "linux")).toBe(true);
  });

  it("never equates a subdirectory with its parent", () => {
    expect(samePath("C:/a/b", "C:/a", "win32")).toBe(false);
    expect(samePath("C:/a", "C:/a/b", "win32")).toBe(false);
    expect(samePath("/repo/src", "/repo", "linux")).toBe(false);
  });
});

describe("isSameOrInside", () => {
  it("accepts a Windows child under a git-style forward-slash parent, any case", () => {
    expect(
      isSameOrInside("C:/Users/X/repo", "c:\\users\\x\\repo\\sub", "win32"),
    ).toBe(true);
    expect(
      isSameOrInside("C:/Users/x/repo", "C:\\Users\\x\\repo", "win32"),
    ).toBe(true);
  });

  it("rejects a Windows parent directory, a sibling and a prefix-sharing name", () => {
    expect(isSameOrInside("C:/Users/x/repo", "C:\\Users\\x", "win32")).toBe(
      false,
    );
    expect(
      isSameOrInside("C:/Users/x/repo", "C:\\Users\\x\\repo2", "win32"),
    ).toBe(false);
    expect(
      isSameOrInside("C:/Users/x/repo", "D:\\Users\\x\\repo\\a", "win32"),
    ).toBe(false);
  });

  it("is case-sensitive off win32 and handles a root parent", () => {
    expect(isSameOrInside("/repo", "/Repo/sub", "linux")).toBe(false);
    expect(isSameOrInside("/repo", "/repo/sub", "linux")).toBe(true);
    expect(isSameOrInside("/", "/repo", "linux")).toBe(true);
  });
});
