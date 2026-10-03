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
/** The two prefix kinds only: a `closed` rule carries no from/to. */
type PrefixRule = Extract<ContractRule, { kind: "forbid" | "allow-only" }>;
const rule = (
  kind: PrefixRule["kind"],
  from: string,
  to: string,
): PrefixRule => ({ id: "r1", kind, from, to, severity: "error" });
/** A `closed` rule has no from/to: the slice is the from side, `except` the only way out. */
const closed = (except: string[]): ContractRule => ({
  id: "c1",
  kind: "closed",
  except,
  severity: "error",
});
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

describe("edgeViolatesRule: the closed kind", () => {
  it("fails every outward edge when the except list is empty", () => {
    const r = closed([]);
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "other/c.ts"))).toBe(
      true,
    );
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "other"))).toBe(true);
    // inside the slice: the rule adds nothing to an edge the slice allows
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "app/b.ts"))).toBe(
      false,
    );
  });

  it("an except prefix lets its own targets pass and still fails the rest", () => {
    const r = closed(["lib/"]);
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "lib/b.ts"))).toBe(
      false,
    );
    // `libs/` is not `lib/`: a prefix is not a loose match
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "libs/b.ts"))).toBe(
      true,
    );
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "other/c.ts"))).toBe(
      true,
    );
  });

  it("holds two accepted crossings out of one from, and still fails a third", () => {
    // the case the allow-only recipe cannot express: rules are ANDed
    const r = closed(["lib/", "shared/"]);
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "lib/b.ts"))).toBe(
      false,
    );
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "shared/s.ts"))).toBe(
      false,
    );
    expect(edgeViolatesRule(slice, r, edge("app/a.ts", "other/o.ts"))).toBe(
      true,
    );
  });

  it("matches a package root under both spellings, and a file entry exactly", () => {
    expect(
      edgeViolatesRule(
        slice,
        closed(["libs/shared/"]),
        edge("app/a.ts", "libs/shared"),
      ),
    ).toBe(false);
    expect(
      edgeViolatesRule(
        slice,
        closed(["libs/shared/"]),
        edge("app/a.ts", "libs/shared/x.ts"),
      ),
    ).toBe(false);
    // without a trailing `/` an entry is an exact file, so it lets nothing else out
    expect(
      edgeViolatesRule(
        slice,
        closed(["libs/shared"]),
        edge("app/a.ts", "libs/shared"),
      ),
    ).toBe(false);
    expect(
      edgeViolatesRule(
        slice,
        closed(["libs/shared"]),
        edge("app/a.ts", "libs/shared/x.ts"),
      ),
    ).toBe(true);
  });

  it("an except cannot re-open an excluded target, and an excluded source is not judged", () => {
    expect(
      edgeViolatesRule(
        slice,
        closed(["app/gen/"]),
        edge("app/a.ts", "app/gen/x.ts"),
      ),
    ).toBe(true);
    expect(
      edgeViolatesRule(
        slice,
        closed(["app/"]),
        edge("app/a.ts", "app/gen/x.ts"),
      ),
    ).toBe(true);
    expect(
      edgeViolatesRule(slice, closed([]), edge("app/gen/a.ts", "other/c.ts")),
    ).toBe(false);
  });

  it("the root package target (.) is never inside an except prefix", () => {
    // No legal except entry is `.` (the schema refuses it), so every entry leaves
    // the root package outside: it always violates.
    expect(
      edgeViolatesRule(slice, closed(["lib/", "app/"]), edge("app/a.ts", ".")),
    ).toBe(true);
    expect(
      edgeViolatesRule(slice, closed(["lib/"]), edge("app/a.ts", ".")),
    ).toBe(true);
  });

  it("a baselined closed violation is hidden until its expires day ends", () => {
    const contract = {
      knownViolations: [
        { rule: "c1", file: "app/a.ts", specifier: "x", expires: "2026-10-01" },
      ],
    };
    const v = { rule: "c1", file: "app/a.ts", specifier: "x" };
    expect(isKnown(contract, v, new Date("2026-10-01T23:59:59.999Z"))).toBe(
      true,
    );
    expect(isKnown(contract, v, new Date("2026-10-02T00:00:00.000Z"))).toBe(
      false,
    );
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
