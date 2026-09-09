import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { Finding } from "../../src/domain/findings/finding.js";
import {
  findingAppliesToVersion,
  findingMatchesQuery,
  findingMatchesStatus,
  findingMatchesTemplate,
  type FindingQuery,
} from "../../src/domain/findings/finding-query.js";

/**
 * The query predicates are pure domain: they take a `Finding` value and a
 * query option, so these tests construct findings directly and need no
 * fixture tree — the point of keeping the predicates out of the reader.
 */

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "0001",
    subject: "ci-github-actions",
    subjectKind: "template",
    subjectVersion: "1.2.0",
    fixedIn: null,
    class: "host-assumption",
    severity: "high",
    surface: "ci",
    status: "open",
    body: "## What happens\n\nsynthetic repro prose",
    ...overrides,
  };
}

describe("findingAppliesToVersion", () => {
  it("a finding with fixedIn null always applies, whatever is asked", () => {
    assert.equal(findingAppliesToVersion(finding(), "1.4.0"), true);
    assert.equal(findingAppliesToVersion(finding(), "0.1.0"), true);
  });

  it("excludes a finding whose fixedIn precedes the asked version", () => {
    // The plan's own sentence: "I am on 1.4.0; a finding fixed in 1.3.0 no
    // longer applies to me."
    const f = finding({ status: "fixed", fixedIn: "1.3.0" });
    assert.equal(findingAppliesToVersion(f, "1.4.0"), false);
  });

  it("a finding fixed exactly at the asked version still applies", () => {
    // The rule excludes fixes that PRECEDE the asked version; the boundary
    // version itself carries the fix in name but is not strictly earlier, so
    // it stays — pinned here so nobody "fixes" the boundary into hiding.
    const f = finding({ status: "fixed", fixedIn: "1.3.0" });
    assert.equal(findingAppliesToVersion(f, "1.3.0"), true);
  });

  it("a finding fixed after the asked version still applies", () => {
    // My version predates the fix, so the defect is still live in it.
    const f = finding({ status: "fixed", fixedIn: "1.5.0" });
    assert.equal(findingAppliesToVersion(f, "1.4.0"), true);
  });

  it("a finding recorded against a subjectVersion ahead of the asked version still applies", () => {
    // The version filter is fixedIn-only: subjectVersion says where the
    // finding was made, not when the defect stops. A record carrying only
    // "found in 1.5.0" says nothing about 1.4.0's exposure either way, and
    // silently dropping it would hide a possibly-live defect behind a filter
    // the plan never asked for.
    const f = finding({
      subjectVersion: "1.5.0",
      fixedIn: null,
      status: "open",
    });
    assert.equal(findingAppliesToVersion(f, "1.4.0"), true);
  });

  it("refuses to decide against a query version that is not well-formed semver", () => {
    assert.throws(
      () => findingAppliesToVersion(finding({ fixedIn: "0.9.0" }), "1.4"),
      /query version '1\.4' is not a well-formed semver/,
    );
  });

  it("refuses to decide against a fixedIn that is not well-formed semver", () => {
    // Hand-built Findings can carry garbage the read path's validator would
    // refuse; compareSemver would return NaN and NaN >= 0 is false, so the
    // filter would silently exclude instead of naming the bad record.
    assert.throws(
      () => findingAppliesToVersion(finding({ fixedIn: "banana" }), "1.4.0"),
      /fixedIn 'banana' is not a well-formed semver/,
    );
  });
});

describe("findingMatchesTemplate", () => {
  it("narrows to findings whose subject is the named template id, and only those", () => {
    const mine = finding();
    const other = finding({ subject: "agents-md" });
    assert.equal(findingMatchesTemplate(mine, "ci-github-actions"), true);
    assert.equal(findingMatchesTemplate(other, "ci-github-actions"), false);
  });
});

describe("findingMatchesStatus", () => {
  it("narrows to findings in the named status, and only those", () => {
    assert.equal(
      findingMatchesStatus(finding({ status: "open" }), "open"),
      true,
    );
    assert.equal(
      findingMatchesStatus(finding({ status: "fixed" }), "open"),
      false,
    );
    assert.equal(
      findingMatchesStatus(finding({ status: "wontfix" }), "wontfix"),
      true,
    );
  });
});

describe("findingMatchesQuery", () => {
  const all = [
    finding({ id: "0001" }),
    finding({
      id: "0002",
      subject: "agents-md",
      surface: "dx",
      status: "fixed",
      fixedIn: "1.3.0",
    }),
    finding({ id: "0003", subject: "agents-md", severity: "low" }),
  ];

  it("an empty query is no filter: every finding matches", () => {
    assert.deepStrictEqual(
      all.filter((f) => findingMatchesQuery(f, {})),
      all,
    );
  });

  it("options present but undefined are no filter, same as absent", () => {
    const query = {
      template: undefined,
      version: undefined,
      status: undefined,
    } satisfies FindingQuery;
    assert.deepStrictEqual(
      all.filter((f) => findingMatchesQuery(f, query)),
      all,
    );
  });

  it("each present option narrows, and they combine conjunctively", () => {
    assert.deepStrictEqual(
      all.filter((f) => findingMatchesQuery(f, { template: "agents-md" })),
      [all[1], all[2]],
    );
    assert.deepStrictEqual(
      all.filter((f) => findingMatchesQuery(f, { status: "fixed" })),
      [all[1]],
    );
    assert.deepStrictEqual(
      all.filter((f) => findingMatchesQuery(f, { version: "1.4.0" })),
      [all[0], all[2]],
    );
    // Together: agents-md + open + past 1.4.0 — only 0003 survives all three.
    assert.deepStrictEqual(
      all.filter((f) =>
        findingMatchesQuery(f, {
          template: "agents-md",
          status: "open",
          version: "1.4.0",
        }),
      ),
      [all[2]],
    );
  });
});
