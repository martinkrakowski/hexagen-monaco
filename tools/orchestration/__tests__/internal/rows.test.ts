import { describe, expect, test } from "vitest";
import {
  asHashRecord,
  InvalidRiskCellError,
  rowHash,
  rowRisk,
} from "../../src/internal/rows.js";

const plan = [
  "# The plan",
  "",
  "| Lane | Delivers |",
  "|---|---|",
  "| **PT-5a** | The campaign id, exposed and resolvable (D168, D178, D179). |",
  "| **PT-5b1** | Every campaign-addressed route accepts the id or the slug (D178). |",
  "",
  "## 2. Decisions",
  "",
  "| id | Decision |",
  "|---|---|",
  "| **D177** | Create is a server call. |",
  "| **D178** | Routes and links carry ids; slugs display only. |",
].join("\n");

describe("rowHash", () => {
  test("a whitespace-only reflow of a row keeps its hash", () => {
    const reflowed = plan.replace(
      "| **PT-5a** | The campaign id, exposed and resolvable (D168, D178, D179). |",
      "| **PT-5a** |  The  campaign id,   exposed and resolvable (D168, D178, D179).  |",
    );
    expect(rowHash(reflowed, "PT-5a")).toBe(rowHash(plan, "PT-5a"));
  });

  test("a one-word change to the row gives a different hash", () => {
    const edited = plan.replace(
      "exposed and resolvable",
      "hidden and unresolvable",
    );
    expect(rowHash(edited, "PT-5a")).not.toBe(rowHash(plan, "PT-5a"));
  });

  test("the normalisation itself is the fingerprint: trim, then collapse whitespace runs", () => {
    const row = "  | **PT-5a** |  The   campaign id.  |  \n";
    expect(rowHash(row, "PT-5a")).toBe(
      rowHash("| **PT-5a** | The campaign id. |", "PT-5a"),
    );
  });

  test("a row whose text carries a pipe inside backticks still matches and hashes whole", () => {
    const row =
      "| **PT-5b1** | The route reads `getPoolStore(scope) | withPools` first. |";
    expect(() => rowHash(row, "PT-5b1")).not.toThrow();
    const reflowed = row.replace(
      "`getPoolStore(scope) | withPools`",
      "`getPoolStore(scope)  |  withPools`",
    );
    expect(rowHash(reflowed, "PT-5b1")).toBe(rowHash(row, "PT-5b1"));
  });

  test("zero matches is an error naming the id and the count", () => {
    expect(() => rowHash(plan, "PT-9")).toThrow(/PT-9/);
    expect(() => rowHash(plan, "PT-9")).toThrow(/found 0/);
  });

  test("a row mentioned twice is an error naming the id and the count", () => {
    const duplicated = `${plan}\n| **PT-5a** | A second row with the same first cell. |`;
    expect(() => rowHash(duplicated, "PT-5a")).toThrow(/found 2/);
  });

  test("an id that is a prefix of another id's cell matches only its own row", () => {
    const longer = `${plan}\n| **PT-5a2** | A longer id sharing the prefix. |`;
    expect(rowHash(longer, "PT-5a")).toBe(rowHash(plan, "PT-5a"));
  });

  test("a decision row hashes by the same rule as a lane row", () => {
    expect(rowHash(plan, "D177")).toMatch(/^[0-9a-f]{64}$/);
    const edited = plan.replace(
      "Create is a server call.",
      "Create is a client call.",
    );
    expect(rowHash(edited, "D177")).not.toBe(rowHash(plan, "D177"));
  });
});

describe("rowRisk", () => {
  const risked = [
    "| Lane | Risk | Delivers |",
    "|---|---|---|",
    "| **HX1** | **high** | Split the reserved list. |",
    "| **HX4** | normal | Plan rows carry a risk tier. |",
  ].join("\n");

  test("a bolded **high** second cell is high", () => {
    expect(rowRisk(risked, "HX1")).toBe("high");
  });

  test("the literal word normal is normal", () => {
    expect(rowRisk(risked, "HX4")).toBe("normal");
  });

  test("a table with no Risk column defaults to normal, as in the platform plan", () => {
    expect(rowRisk(plan, "PT-5a")).toBe("normal");
  });

  test("a plain unbolded high is refused, not read as normal (A-1)", () => {
    const unbolded = "| **HX1** | high | Split the reserved list. |";
    expect(() => rowRisk(unbolded, "HX1")).toThrow(InvalidRiskCellError);
  });

  test("a **high** carrying a trailing note is refused (A-1)", () => {
    const annotated =
      "| **HX1** | **high** (N-6, raised from normal) | Split the list. |";
    expect(() => rowRisk(annotated, "HX1")).toThrow(InvalidRiskCellError);
  });

  test("the refusal names the row and quotes the cell it refused", () => {
    const unbolded = "| **HX1** | high | Split the reserved list. |";
    expect(() => rowRisk(unbolded, "HX1")).toThrow(/HX1/);
    expect(() => rowRisk(unbolded, "HX1")).toThrow(/"high"/);
  });

  test("a row outside any table header still reads its risk cell, as this plan's OW4-OW6 rows do", () => {
    // This plan splits one Wave 1 table with a prose line, so the OW4-OW6 rows
    // sit under NO header. A header-based rule would read them as normal — the
    // original bug reached by another route — so the cell alone decides, here.
    const split = [
      "| Lane | Risk | Delivers |",
      "|---|---|---|",
      "| **OW3** | **high** | Ports sixteen bins. |",
      "",
      "OW3 blocks OW4, OW5, and OW6.",
      "",
      "| **OW4** | **high** | Moves the skill into the template. |",
      "| **OW6** | **high** | Rewires the skill home. |",
    ].join("\n");
    expect(rowRisk(split, "OW4")).toBe("high");
    expect(rowRisk(split, "OW6")).toBe("high");
    expect(rowRisk(split, "OW3")).toBe("high");
  });

  test("a differently-cased or differently-bolded tier is refused, not guessed at", () => {
    for (const cell of ["**Normal**", "HIGH", "**normal**"]) {
      const row = `| **HX1** | ${cell} | Split the reserved list. |`;
      expect(() => rowRisk(row, "HX1"), cell).toThrow(InvalidRiskCellError);
    }
  });

  test("a cell that merely contains a risk word later on stays normal", () => {
    const row =
      "| **PT-5a** | This lane has a high risk of being reimplemented. |";
    expect(rowRisk(row, "PT-5a")).toBe("normal");
  });

  test("a pipe inside backticks in the second cell still defaults to normal, not high", () => {
    const row =
      "| **PT-5b1** | The route reads `getPoolStore(scope) | withPools` first. |";
    expect(rowRisk(row, "PT-5b1")).toBe("normal");
  });

  test("zero or ambiguous matches throws, same as rowHash", () => {
    expect(() => rowRisk(plan, "PT-9")).toThrow(/found 0/);
    const duplicated = `${risked}\n| **HX1** | **high** | A second row with the same id. |`;
    expect(() => rowRisk(duplicated, "HX1")).toThrow(/found 2/);
  });
});

describe("duplicate rows name every matching line", () => {
  // Line 5 is the lane table row; the shipped table repeats its bold id on line 11.
  const twice = [
    "# The plan",
    "",
    "| Lane | Delivers |",
    "|---|---|",
    "| **OW1** | The first row, in the lane table. |",
    "",
    "## Shipped",
    "",
    "| Lane | PR |",
    "|---|---|",
    "| **OW1** | #12 merged, in the shipped table. |",
  ].join("\n");

  test.each([
    ["rowHash", (plan?: string) => rowHash(twice, "OW1", plan)],
    ["rowRisk", (plan?: string) => rowRisk(twice, "OW1", plan)],
  ])("%s names both line numbers and the start of each line", (_n, call) => {
    expect(() => call()).toThrow(/found 2/);
    expect(() => call()).toThrow(/line 5: .*The first row/);
    expect(() => call()).toThrow(/line 11: .*#12 merged/);
  });

  test.each([
    ["rowHash", (plan?: string) => rowHash(twice, "OW1", plan)],
    ["rowRisk", (plan?: string) => rowRisk(twice, "OW1", plan)],
  ])("%s names the plan file when the caller knows it", (_n, call) => {
    expect(() => call("docs/planning/plan.md")).toThrow(
      /docs\/planning\/plan\.md/,
    );
  });

  test("a long line is cut to its start, not printed whole", () => {
    const long = "| **OW1** | " + "x".repeat(500) + " |";
    try {
      rowHash(`${long}\n${long}`, "OW1");
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(400);
    }
  });
});

describe("asHashRecord", () => {
  test("a map whose every value is a string is accepted verbatim", () => {
    expect(asHashRecord({ "PT-5a": "aa", D177: "bb" })).toEqual({
      "PT-5a": "aa",
      D177: "bb",
    });
  });

  test("an empty map is a valid, empty record", () => {
    expect(asHashRecord({})).toEqual({});
  });

  test("a non-object, an array, a null, or a map with a non-string value is refused", () => {
    expect(asHashRecord("rows")).toBeUndefined();
    expect(asHashRecord(["aa"])).toBeUndefined();
    expect(asHashRecord(null)).toBeUndefined();
    expect(asHashRecord({ "PT-5a": 7 })).toBeUndefined();
  });
});
