import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { filterToRequestedContexts } from "../../../src/domain/manifest/filter-stage-output";

describe("filterToRequestedContexts", () => {
  it("keeps requested entries and drops echoes, reporting the dropped names", () => {
    const { kept, droppedContextNames } = filterToRequestedContexts(
      [
        { contextName: "web-ui" },
        { contextName: "real-esrgan" }, // grounding echo — not requested
        { contextName: "file-system" },
      ],
      ["WebUI", "file-system"],
    );
    assert.deepEqual(
      kept.map((k) => k.contextName),
      ["web-ui", "file-system"],
    );
    assert.deepEqual(droppedContextNames, ["real-esrgan"]);
  });

  it("matches across casing/kebab variants (normalized comparison)", () => {
    const { kept, droppedContextNames } = filterToRequestedContexts(
      [{ contextName: "ImageDomain" }],
      ["image-domain"],
    );
    assert.equal(kept.length, 1);
    assert.equal(droppedContextNames.length, 0);
  });

  it("passes everything through when all entries were requested", () => {
    const entries = [{ contextName: "a" }, { contextName: "b" }];
    const { kept, droppedContextNames } = filterToRequestedContexts(entries, [
      "a",
      "b",
    ]);
    assert.deepEqual(kept, entries);
    assert.deepEqual(droppedContextNames, []);
  });
});
