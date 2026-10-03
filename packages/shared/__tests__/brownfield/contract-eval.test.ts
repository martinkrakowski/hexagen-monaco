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

  it("rules are paired as a multiset, so a reordered duplicate id is not a downgrade", () => {
    const error = rule();
    const warn = rule({ severity: "warn" });
    const swap = contract({ rules: [error, warn] });
    const swapped = contract({ rules: [warn, error] });
    // Same two rules, opposite order. Pairing on the first id match paired the
    // base's error rule with the tree's warn rule and called it a downgrade.
    expect(findContractGrowth(sides(swap, swapped))).toEqual([]);

    // A multiset comparison still catches the real loss: the error became a warn.
    const lost = findContractGrowth(
      sides(swap, contract({ rules: [warn, warn] })),
    );
    expect(lost.map((g) => [g.kind, g.detail])).toEqual([
      ["rule-field-changed", "rule no-ui-api severity changed (error -> warn)"],
    ]);

    // An identical duplicate on each side cancels out; an extra strict rule does
    // not make the tree weaker.
    expect(
      findContractGrowth(
        sides(swap, contract({ rules: [error, warn, error] })),
      ),
    ).toEqual([]);

    // A tree rule can only cancel ONE base rule: dropping the warn instance
    // takes its warnings with it, even though the id is still present.
    expect(
      findContractGrowth(sides(swap, contract({ rules: [error] }))).map((g) => [
        g.kind,
        g.detail,
      ]),
    ).toEqual([["rule-removed", "rule no-ui-api removed"]]);
  });

  it("entries are compared as a multiset, so an exact duplicate cancels out", () => {
    const dated = entry({ expires: "2026-12-01" });
    const permanent = entry();
    const kinds = (
      baseEntries: Contract["knownViolations"],
      treeEntries: Contract["knownViolations"],
    ) =>
      findContractGrowth(
        sides(
          contract({ knownViolations: baseEntries }),
          contract({ knownViolations: treeEntries }),
        ),
      ).map((g) => g.kind);

    // The dated one first, then a permanent duplicate: removing the dated entry
    // leaves a suppression that covers more, not a dropped expiry. Pairing on
    // the first match reported the reverse.
    expect(kinds([dated, permanent], [permanent])).toEqual([]);
    // The other order matters too, and so does a longer date hiding behind a
    // shorter one.
    expect(kinds([permanent, dated], [permanent])).toEqual([]);
    expect(kinds([dated, entry({ expires: "2027-01-01" })], [dated])).toEqual(
      [],
    );
    expect(kinds([dated], [permanent])).toEqual(["expires-dropped"]);
    expect(kinds([dated], [entry({ expires: "2027-01-01" })])).toEqual([
      "expires-extended",
    ]);
    // The reverse is the ratchet moving forward.
    expect(kinds([permanent], [dated])).toEqual([]);
    // A permanent entry added where the base had a dated one is new coverage for
    // a violation the base never listed, not a second entry for the same one.
    expect(kinds([dated], [dated, permanent])).toEqual([]);
    // The residue is judged against the longest cover the base still has, not
    // against whichever entry happened to come first in the file.
    expect(
      findContractGrowth(
        sides(
          contract({
            knownViolations: [entry({ expires: "2027-01-01" }), dated],
          }),
          contract({ knownViolations: [permanent] }),
        ),
      ).map((g) => g.detail),
    ).toEqual([
      "knownViolations entry r1  a.ts  x expires dropped (was 2027-01-01)",
    ]);
  });

  it("an entry the base did not have is growth; an expiry added to one is not", () => {
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
    // An expiry where the base had none makes the suppression stop sooner: the
    // ratchet moving forward. Only a date pushed later from a date is growth.
    expect(
      findContractGrowth(
        sides(
          base,
          contract({ knownViolations: [entry({ expires: "2026-12-01" })] }),
        ),
      ),
    ).toEqual([]);
    const dated = contract({
      knownViolations: [entry({ expires: "2026-12-01" })],
    });
    expect(
      findContractGrowth(
        sides(
          dated,
          contract({ knownViolations: [entry({ expires: "2027-12-01" })] }),
        ),
      ).map((g) => g.detail),
    ).toEqual([
      "knownViolations entry r1  a.ts  x expires extended 2026-12-01 -> 2027-12-01",
    ]);
  });

  it("an edit to the identity of an entry the base had is growth", () => {
    const base = contract({ knownViolations: [entry()] });
    const found = (tree: Pick<Contract, "rules" | "knownViolations">) =>
      findContractGrowth(sides(base, tree)).map((g) => [g.kind, g.detail]);
    // rule+file+specifier IS the entry's coverage key, so any edit to it is
    // reviewed like a rule's from/to: the guard cannot compare what a changed
    // key would cover, and a wider key hides violations the base did not hide.
    expect(
      found(contract({ knownViolations: [entry({ file: "src" })] })),
    ).toEqual([
      [
        "entry-identity-changed",
        "knownViolations entry r1  a.ts  x file changed to src",
      ],
    ]);
    expect(
      found(contract({ knownViolations: [entry({ specifier: "@app/*" })] })),
    ).toEqual([
      [
        "entry-identity-changed",
        "knownViolations entry r1  a.ts  x specifier changed to @app/*",
      ],
    ]);
    // A reason is a note on the entry, not its coverage: not growth.
    expect(
      found(contract({ knownViolations: [entry({ reason: "why" })] })),
    ).toEqual([]);
    // With a second entry for the same rule on both sides the edit cannot be
    // attributed to one of them, so it is reported as the new entry it looks
    // like — still growth, never a pass.
    const two = contract({
      knownViolations: [entry(), entry({ file: "b.ts" })],
    });
    expect(
      findContractGrowth(
        sides(two, {
          ...contract({}),
          knownViolations: [entry({ file: "src" }), entry({ file: "b.ts" })],
        }),
      ).map((g) => g.kind),
    ).toEqual(["known-violation-added"]);
    // An expires edit is still judged on its own terms, naming the base entry.
    const dated = contract({
      knownViolations: [entry({ expires: "2026-01-01" })],
    });
    expect(
      findContractGrowth(
        sides(
          dated,
          contract({ knownViolations: [entry({ expires: "2026-12-01" })] }),
        ),
      ).map((g) => [g.kind, g.detail]),
    ).toEqual([
      [
        "expires-extended",
        "knownViolations entry r1  a.ts  x expires extended 2026-01-01 -> 2026-12-01",
      ],
    ]);
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

  it("a removed or narrowed slice paths entry is growth, and an added one is not", () => {
    const c = contract({});
    const at = (paths: string[]) => {
      const slice = { paths, excludes: [] as string[] };
      return { contract: c, slice, tree: { contract: c, slice } };
    };
    expect(findContractGrowth(at(["ui/", "api/"]))).toEqual([]);

    expect(
      findContractGrowth({
        ...at(["ui/", "api/"]),
        tree: { contract: c, slice: { paths: ["ui/"], excludes: [] } },
      }),
    ).toEqual([
      {
        kind: "paths-entry-removed",
        detail: "slice paths entry api/ removed",
      },
    ]);

    // A longer prefix covers less, so it is growth even when the entry is kept.
    expect(
      findContractGrowth({
        ...at(["ui/", "api/"]),
        tree: {
          contract: c,
          slice: { paths: ["ui/", "api/v1/"], excludes: [] },
        },
      }),
    ).toEqual([
      {
        kind: "paths-entry-narrowed",
        detail: "slice paths entry api/ narrowed (now api/v1/)",
      },
    ]);
    expect(
      findContractGrowth({
        ...at(["api/"]),
        tree: {
          contract: c,
          slice: { paths: ["api/", "api/v1/"], excludes: [] },
        },
      }).map((g) => g.kind),
    ).toEqual(["paths-entry-narrowed"]);

    // Adding a prefix widens what is judged: not growth.
    expect(
      findContractGrowth({
        ...at(["ui/"]),
        tree: { contract: c, slice: { paths: ["ui/", "lib/"], excludes: [] } },
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
