import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ObservedReport, Slice, Contract } from "@hexagen/shared";
import type { LoadedBundle } from "../../bundle/read-bundle";

vi.mock("../derive", async (orig) => {
  const real = await orig<typeof import("../derive")>();
  return {
    ...real,
    sliceView: vi.fn(real.sliceView),
    packageEdges: vi.fn(real.packageEdges),
  };
});
import * as derive from "../derive";
import { MiddlePanel } from "../MiddlePanel";

const repo = { commit: "0123456789abcdef0123456789abcdef01234567" };
const NOW = "2026-10-01T10:00:00.000Z";
const observed: ObservedReport = {
  schemaVersion: "1.0.0",
  repo,
  generatedAt: NOW,
  packages: {
    collected: true,
    items: [
      { name: "a", root: "a", manifestFile: "a/package.json" },
      { name: "b", root: "b", manifestFile: "b/package.json" },
    ],
  },
  languages: { collected: true, items: [] },
  build: { collected: true, items: [] },
  generated: { collected: true, items: [] },
  dontTouch: { collected: true, items: [] },
  edges: {
    collected: true,
    unreadLanguages: [],
    items: [{ from: "a/x.ts", to: "b/y.ts", specifier: "b" }],
  },
  unresolved: { collected: true, items: [] },
  limits: { truncated: false, reasons: [] },
};
const slice: Slice = {
  schemaVersion: "1.0.0",
  id: "s",
  repo,
  paths: ["a/"],
  excludes: [],
  createdBy: "fde",
  createdAt: NOW,
};
const contract: Contract = {
  schemaVersion: "1.0.0",
  sliceId: "s",
  rules: [],
  knownViolations: [],
};
const bundleOf = (o: ObservedReport): LoadedBundle => ({
  index: {
    schemaVersion: "1.0.0",
    createdAt: NOW,
    sliceId: "s",
    files: [],
    hmac: "0".repeat(64),
  },
  texts: new Map(),
  observed: o,
  slice,
  contract,
  tip: null,
  grants: [],
  proposals: [],
  proposalFiles: new Map(),
  trace: null,
  verdicts: null,
});

describe("derivations are memoised and lazy", () => {
  it("does not recompute edge groups when only view state changes", () => {
    const b = bundleOf(observed);
    render(<MiddlePanel bundle={b} />);
    const before = vi.mocked(derive.packageEdges).mock.calls.length;
    expect(before).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: /expand/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /hide proposed/i }));
    expect(vi.mocked(derive.packageEdges).mock.calls.length).toBe(before);
  });

  it("does not judge the slice while the proposed layer is hidden", () => {
    const { rerender } = render(<MiddlePanel bundle={bundleOf(observed)} />);
    fireEvent.click(screen.getByRole("button", { name: /hide proposed/i }));
    const hiddenAt = vi.mocked(derive.sliceView).mock.calls.length;
    rerender(<MiddlePanel bundle={bundleOf({ ...observed })} />);
    expect(vi.mocked(derive.sliceView).mock.calls.length).toBe(hiddenAt);
    fireEvent.click(screen.getByRole("button", { name: /show proposed/i }));
    expect(vi.mocked(derive.sliceView).mock.calls.length).toBe(hiddenAt + 1);
  });
});
