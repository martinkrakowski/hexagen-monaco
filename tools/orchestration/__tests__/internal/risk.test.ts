import { describe, expect, test } from "vitest";
import { discoverRisk } from "../../src/internal/risk.js";
import { InvalidRiskCellError } from "../../src/internal/rows.js";

const highPlan = [
  "| Lane | Risk | Delivers |",
  "|---|---|---|",
  "| **HX1-route-segments-reserved** | **high** | Split the reserved list. |",
].join("\n");

const normalPlan = [
  "| Lane | Risk | Delivers |",
  "|---|---|---|",
  "| **HX4-pre-pr-review-gate** | normal | Plan rows carry a risk tier. |",
].join("\n");

const noRiskColumnPlan = [
  "| Lane | Delivers |",
  "|---|---|",
  "| **PT-5a** | The campaign id, exposed and resolvable. |",
].join("\n");

interface Fixture {
  readonly [path: string]: string;
}

const ioOver = (files: Fixture) => ({
  readdir: async (dir: string): Promise<readonly string[]> => {
    const prefix = `${dir}/`;
    return Object.keys(files)
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length));
  },
  readFile: async (path: string): Promise<string> => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  },
});

describe("discoverRisk", () => {
  test("finds the lane's row in the one plan that names it", async () => {
    const io = ioOver({ "docs/planning/a.md": highPlan });
    expect(
      await discoverRisk("HX1-route-segments-reserved", "docs/planning", io),
    ).toBe("high");
  });

  test("a normal row reads normal", async () => {
    const io = ioOver({ "docs/planning/a.md": normalPlan });
    expect(
      await discoverRisk("HX4-pre-pr-review-gate", "docs/planning", io),
    ).toBe("normal");
  });

  test("a lane found in no plan is undefined — never normal", async () => {
    // Undefined and normal are different answers: "this gate has never heard
    // of this lane" must not read the same as "this gate cleared it".
    const io = ioOver({ "docs/planning/a.md": highPlan });
    expect(
      await discoverRisk("HX9-nonexistent", "docs/planning", io),
    ).toBeUndefined();
  });

  test("a plan without a Risk column parses as normal, as in the platform plan", async () => {
    const io = ioOver({ "docs/planning/a.md": noRiskColumnPlan });
    expect(await discoverRisk("PT-5a", "docs/planning", io)).toBe("normal");
  });

  test("a fail-closed union: ANY plan saying high wins, whatever order files sort in", async () => {
    const io = ioOver({
      "docs/planning/b-later.md": highPlan,
      "docs/planning/a-earlier.md": normalPlan.replace(
        "HX4-pre-pr-review-gate",
        "HX1-route-segments-reserved",
      ),
    });
    // a-earlier.md sorts first and names HX1 as normal; b-later.md (high)
    // must still win — an old plan's normal row must never shadow a new
    // plan's high one.
    expect(
      await discoverRisk("HX1-route-segments-reserved", "docs/planning", io),
    ).toBe("high");
  });

  test("sorted order only decides which NORMAL match is reported, when none say high", async () => {
    const io = ioOver({
      "docs/planning/a-earlier.md": normalPlan,
      "docs/planning/b-later.md": normalPlan,
    });
    expect(
      await discoverRisk("HX4-pre-pr-review-gate", "docs/planning", io),
    ).toBe("normal");
  });

  test("a plan whose row is ambiguous (0 or 2+ matches) is skipped, not thrown", async () => {
    const duplicated = `${highPlan}\n| **HX1-route-segments-reserved** | normal | A duplicate row. |`;
    const io = ioOver({
      "docs/planning/a-ambiguous.md": duplicated,
      "docs/planning/b-clear.md": highPlan,
    });
    expect(
      await discoverRisk("HX1-route-segments-reserved", "docs/planning", io),
    ).toBe("high");
  });

  test("non-.md files under the directory are never read", async () => {
    const io = {
      readdir: async (): Promise<readonly string[]> => ["notes.txt", "a.md"],
      readFile: async (path: string): Promise<string> => {
        if (path.endsWith("notes.txt"))
          throw new Error("must not read non-markdown files");
        return highPlan;
      },
    };
    expect(
      await discoverRisk("HX1-route-segments-reserved", "docs/planning", io),
    ).toBe("high");
  });

  test("an unreadable planning directory is undefined — never normal", async () => {
    const io = {
      readdir: async (): Promise<readonly string[]> => {
        throw new Error("ENOENT: no such directory");
      },
      readFile: async (): Promise<string> => {
        throw new Error("unreachable");
      },
    };
    expect(
      await discoverRisk("HX1-route-segments-reserved", "docs/planning", io),
    ).toBeUndefined();
  });

  test("a file that cannot be read is skipped in favour of the next", async () => {
    // "a-broken.md" must sort BEFORE "b-ok.md", or the loop would return on
    // the working file before ever trying the broken one — proving nothing.
    const io = {
      readdir: async (): Promise<readonly string[]> => [
        "b-ok.md",
        "a-broken.md",
      ],
      readFile: async (path: string): Promise<string> => {
        if (path.endsWith("a-broken.md")) throw new Error("EACCES");
        return highPlan;
      },
    };
    expect(
      await discoverRisk("HX1-route-segments-reserved", "docs/planning", io),
    ).toBe("high");
  });
});

describe("discoverRisk propagates an invalid risk cell (A-1)", () => {
  const malformed = [
    "| Lane | Risk | Delivers |",
    "|---|---|---|",
    "| **HX1-route-segments-reserved** | high | Split the reserved list. |",
  ].join("\n");

  test("a malformed cell propagates instead of being skipped (A-1)", async () => {
    // At the source this was caught and the loop moved on, so whichever plan
    // sorted next supplied the answer and a row that plainly said `high` was
    // reported `normal` — the gate failing open.
    const io = ioOver({ "docs/planning/a.md": malformed });
    await expect(
      discoverRisk("HX1-route-segments-reserved", "docs/planning", io),
    ).rejects.toThrow(InvalidRiskCellError);
  });

  test("it does NOT return normal, even when another plan says normal (A-1)", async () => {
    // The exact shape the brief names: one plan's row says `high` (and means
    // it), another's says `normal`. Fail-closed must not become fail-open here.
    const io = ioOver({
      "docs/planning/a-high.md": malformed,
      "docs/planning/b-normal.md": normalPlan.replace(
        "HX4-pre-pr-review-gate",
        "HX1-route-segments-reserved",
      ),
    });
    await expect(
      discoverRisk("HX1-route-segments-reserved", "docs/planning", io),
    ).rejects.toThrow(InvalidRiskCellError);
  });

  test("the propagated error names the plan file and the row (A-1)", async () => {
    const io = ioOver({ "docs/planning/a-high.md": malformed });
    await expect(
      discoverRisk("HX1-route-segments-reserved", "docs/planning", io),
    ).rejects.toThrow(/a-high\.md.*HX1-route-segments-reserved/s);
  });
});
