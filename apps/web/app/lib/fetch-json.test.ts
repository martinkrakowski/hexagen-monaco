import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { parseNoticeCountHeaders } from "./fetch-json";

describe("parseNoticeCountHeaders", () => {
  it("reads warning + error counts from the sideband headers", () => {
    const headers = new Headers({
      "x-hexagen-addon-warnings": "3",
      "x-hexagen-addon-errors": "2",
    });
    assert.deepEqual(parseNoticeCountHeaders(headers), {
      warnings: 3,
      errors: 2,
    });
  });

  it("is header-name case-insensitive (the route sets X-Hexagen-…)", () => {
    const headers = new Headers({ "X-Hexagen-Addon-Errors": "1" });
    assert.deepEqual(parseNoticeCountHeaders(headers), {
      warnings: 0,
      errors: 1,
    });
  });

  it("returns undefined when both headers are absent (e.g. stripped by a proxy)", () => {
    assert.equal(parseNoticeCountHeaders(new Headers()), undefined);
  });

  it("treats non-numeric or non-positive values as 0 (defensive)", () => {
    const headers = new Headers({
      "x-hexagen-addon-warnings": "not-a-number",
      "x-hexagen-addon-errors": "-5",
    });
    assert.equal(parseNoticeCountHeaders(headers), undefined);
  });

  it("floors fractional counts", () => {
    const headers = new Headers({ "x-hexagen-addon-warnings": "2.9" });
    assert.deepEqual(parseNoticeCountHeaders(headers), {
      warnings: 2,
      errors: 0,
    });
  });
});
