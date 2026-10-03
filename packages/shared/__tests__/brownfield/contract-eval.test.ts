import { describe, it, expect } from "vitest";
import {
  edgeViolatesRule,
  findContractGrowth,
  isKnown,
  isSuppressionExpired,
  prefixHasTarget,
  type Contract,
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

describe("findContractGrowth", () => {
  const rule = (over: Partial<ContractRule> = {}): ContractRule => ({
    id: "no-ui-api",
    kind: "forbid",
    from: "ui/",
    to: "api/",
    severity: "error",
    ...over,
  });
  const entry = (
    over: Partial<Contract["knownViolations"][number]> = {},
  ): Contract["knownViolations"][number] => ({
    rule: "r1",
    file: "a.ts",
    specifier: "x",
    ...over,
  });
  const contract = (over: {
    rules?: ContractRule[];
    knownViolations?: Contract["knownViolations"];
  }): Pick<Contract, "rules" | "knownViolations"> => ({
    rules: over.rules ?? [rule()],
    knownViolations: over.knownViolations ?? [],
  });
  const sides = (
    base: Pick<Contract, "rules" | "knownViolations">,
    tree: Pick<Contract, "rules" | "knownViolations">,
  ) => {
    const slice = { paths: ["ui/", "api/"], excludes: [] as string[] };
    return { contract: base, slice, tree: { contract: tree, slice } };
  };

  it("an entry or an expiry the base did not have is growth", () => {
    const base = contract({ knownViolations: [entry()] });
    expect(findContractGrowth(sides(base, base))).toEqual([]);
    const added = findContractGrowth(
      sides(
        base,
        contract({ knownViolations: [entry(), entry({ file: "b.ts" })] }),
      ),
    );
    expect(added).toHaveLength(1);
    expect(added[0]!.kind).toBe("known-violation-added");
    expect(added[0]!.detail).toContain("b.ts");
    const dated = findContractGrowth(
      sides(
        base,
        contract({ knownViolations: [entry({ expires: "2026-12-01" })] }),
      ),
    );
    expect(dated.map((g) => g.kind)).toEqual(["expires-extended"]);
    expect(dated[0]!.detail).toContain("2026-12-01");
  });

  it("an expiry pushed later is growth and one shortened is not, but a dropped one is", () => {
    const base = contract({
      knownViolations: [entry({ expires: "2026-12-01" })],
    });
    const kinds = (tree: Pick<Contract, "rules" | "knownViolations">) =>
      findContractGrowth(sides(base, tree)).map((g) => g.kind);
    expect(
      kinds(contract({ knownViolations: [entry({ expires: "2027-01-01" })] })),
    ).toEqual(["expires-extended"]);
    expect(
      kinds(contract({ knownViolations: [entry({ expires: "2026-01-01" })] })),
    ).toEqual([]);
    expect(kinds(contract({ knownViolations: [entry()] }))).toEqual([
      "expires-dropped",
    ]);
    // A removed entry is not growth, whatever date it carried.
    expect(kinds(contract({ knownViolations: [] }))).toEqual([]);
  });

  it("a removed rule is growth, a new one is not, and warn -> error is not", () => {
    const base = contract({
      rules: [rule(), rule({ id: "soft", severity: "warn" })],
    });
    const removed = findContractGrowth(
      sides(base, contract({ rules: [rule()] })),
    );
    expect(removed.map((g) => [g.kind, g.detail])).toEqual([
      ["rule-removed", "rule soft removed"],
    ]);
    expect(findContractGrowth(sides(base, base))).toEqual([]);
    const added = findContractGrowth(
      sides(
        base,
        contract({
          rules: [
            rule(),
            rule({ id: "soft", severity: "warn" }),
            rule({ id: "new" }),
          ],
        }),
      ),
    );
    expect(added).toEqual([]);
    const hardened = findContractGrowth(
      sides(
        base,
        contract({ rules: [rule({ severity: "warn" }), rule({ id: "soft" })] }),
      ),
    );
    expect(hardened.map((g) => [g.kind, g.detail])).toEqual([
      ["rule-field-changed", "rule no-ui-api severity changed (error -> warn)"],
    ]);
  });

  it("any kind, from or to edit is growth, including a narrowing", () => {
    for (const over of [
      { from: "ui/ui/" },
      { to: "api/legacy/" },
      { kind: "allow-only" as const },
    ]) {
      const found = findContractGrowth(
        sides(contract({}), contract({ rules: [rule(over)] })),
      );
      expect(found.map((g) => g.kind)).toEqual(["rule-field-changed"]);
      expect(found[0]!.detail).toContain(`no-ui-api ${Object.keys(over)[0]}`);
    }
  });

  it("a new slice exclude is growth and a removed one is not", () => {
    const base = {
      contract: contract({}),
      slice: { paths: ["ui/"], excludes: ["ui/gen/"] },
    };
    const tree = {
      contract: contract({}),
      slice: { paths: ["ui/"], excludes: ["ui/gen/", "ui/legacy/"] },
    };
    expect(findContractGrowth({ ...base, tree })).toEqual([
      {
        kind: "exclude-added",
        detail: "new slice exclude ui/legacy/",
      },
    ]);
    expect(
      findContractGrowth({
        ...base,
        tree: { ...tree, slice: { paths: ["ui/"], excludes: [] } },
      }),
    ).toEqual([]);
  });

  it("a contract absent from the tree reads as every rule removed", () => {
    const found = findContractGrowth({
      contract: contract({}),
      slice: { paths: ["ui/"], excludes: [] },
      tree: { contract: undefined, slice: { paths: ["ui/"], excludes: [] } },
    });
    expect(found.map((g) => g.detail)).toEqual(["rule no-ui-api removed"]);
  });
});
