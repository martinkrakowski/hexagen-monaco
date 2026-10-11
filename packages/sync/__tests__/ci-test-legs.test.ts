import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeLegs, toMatrix } from "../../../scripts/ci/test-legs.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const ws = (
  name: string,
  hasTest: boolean,
): { name: string; dir: string; hasTest: boolean } => ({
  name,
  dir: `/fake/${name}`,
  hasTest,
});

describe("scripts/ci/test-legs.mjs", () => {
  it("puts a tested package that no named leg lists into rest", () => {
    const { legs, errors } = computeLegs(
      [ws("alpha", true), ws("beta", true)],
      {
        one: ["alpha"],
      },
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(legs, [
      { leg: "one", packages: ["alpha"] },
      { leg: "rest", packages: ["beta"] },
    ]);
  });

  it("leaves a package without a test script in no leg", () => {
    const { legs, errors } = computeLegs([ws("alpha", false)], {});
    assert.deepEqual(errors, ['The leg "rest" is empty.']);
    assert.deepEqual(legs, [{ leg: "rest", packages: [] }]);
  });

  it("errors when a named leg names a missing package", () => {
    const { errors } = computeLegs([ws("alpha", true)], { one: ["ghost"] });
    assert.ok(
      errors.some((e) =>
        /"one" lists the package "ghost", which does not exist/.test(e),
      ),
    );
  });

  it("errors when a named leg names a package without a test script", () => {
    const { errors } = computeLegs([ws("alpha", false)], { one: ["alpha"] });
    assert.ok(
      errors.some((e) =>
        /"one" lists the package "alpha", which has no test script/.test(e),
      ),
    );
  });

  it("errors when one package is listed in two named legs", () => {
    const { errors } = computeLegs([ws("alpha", true)], {
      one: ["alpha"],
      two: ["alpha"],
    });
    assert.ok(
      errors.some((e) =>
        /"alpha" is listed in both the legs "one" and "two"/.test(e),
      ),
    );
  });

  it("errors when rest is empty", () => {
    const { errors } = computeLegs([ws("alpha", true)], { one: ["alpha"] });
    assert.deepEqual(errors, ['The leg "rest" is empty.']);
  });

  it("toMatrix joins the packages as turbo filters", () => {
    const matrix = toMatrix([
      { leg: "a", packages: ["one", "two"] },
      { leg: "b", packages: [] },
    ]);
    assert.deepEqual(matrix, {
      include: [
        { leg: "a", filters: "--filter=one --filter=two" },
        { leg: "b", filters: "" },
      ],
    });
  });

  it("--check passes on the real repo", () => {
    execFileSync("node", ["scripts/ci/test-legs.mjs", "--check"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
  });
});
