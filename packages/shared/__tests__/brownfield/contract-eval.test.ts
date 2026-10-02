import { describe, it, expect } from "vitest";
import {
  edgeViolatesRule,
  isKnown,
  isSuppressionExpired,
  prefixHasTarget,
  type ContractRule,
  type ObservedEdge,
} from "../../src/types/brownfield/index";

const slice = { paths: ["app/"], excludes: ["app/gen/"] };
const rule = (
  kind: ContractRule["kind"],
  from: string,
  to: string,
): ContractRule => ({ id: "r1", kind, from, to, severity: "error" });
const edge = (from: string, to: string): ObservedEdge => ({
  from,
  to,
  specifier: "x",
});

describe("edgeViolatesRule", () => {
  it("forbid: flags an in-slice edge into the forbidden prefix", () => {
    const r = rule("forbid", "app/", "lib/");
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "lib/b.ts"))).toBe(true);
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "app/b.ts"))).toBe(
      false,
    );
  });
  it("forbid: a package root target (no trailing slash) matches its prefix", () => {
    const r = rule("forbid", "app/", "lib/");
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "lib"))).toBe(true);
  });
  it("allow-only: only the to prefix and the from prefix are legal", () => {
    const r = rule("allow-only", "app/", "lib/");
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "lib/b.ts"))).toBe(
      false,
    );
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "app/b.ts"))).toBe(
      false,
    );
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "other/c.ts"))).toBe(
      true,
    );
  });
  it("never flags an edge whose source is outside the slice", () => {
    const r = rule("forbid", "other/", "lib/");
    expect(edgeViolatesRule(slice, r, edge("other/a.ts", "lib/b.ts"))).toBe(
      false,
    );
    expect(
      edgeViolatesRule(
        slice,
        rule("forbid", "app/", "lib/"),
        edge("app/gen/a.ts", "lib/b.ts"),
      ),
    ).toBe(false);
  });
  it("the root package target is never inside a prefix", () => {
    expect(prefixHasTarget("lib/", ".")).toBe(false);
  });
});

describe("isSuppressionExpired and isKnown", () => {
  const contract = {
    knownViolations: [
      { rule: "r1", file: "a.ts", specifier: "x", expires: "2026-10-01" },
      { rule: "r1", file: "b.ts", specifier: "y" },
    ],
  };
  it("expires after the end of the named UTC day", () => {
    expect(
      isSuppressionExpired("2026-10-01", new Date("2026-10-01T23:59:59.999Z")),
    ).toBe(false);
    expect(
      isSuppressionExpired("2026-10-01", new Date("2026-10-02T00:00:00.000Z")),
    ).toBe(true);
    expect(() => isSuppressionExpired("2026-02-30")).toThrow();
    expect(() => isSuppressionExpired("nope")).toThrow();
  });
  it("matches rule, file and specifier, honouring expiry at the given time", () => {
    const v = { rule: "r1", file: "a.ts", specifier: "x" };
    expect(isKnown(contract, v, new Date("2026-09-30T00:00:00Z"))).toBe(true);
    expect(isKnown(contract, v, new Date("2026-10-02T00:00:00Z"))).toBe(false);
    expect(
      isKnown(
        contract,
        { ...v, file: "b.ts", specifier: "y" },
        new Date("2030-01-01"),
      ),
    ).toBe(true);
    expect(isKnown(contract, { ...v, specifier: "z" }, new Date())).toBe(false);
    expect(isKnown(undefined, v, new Date())).toBe(false);
  });
});
