/**
 * Cross-context import legality (ADR-0043, RCA #8).
 *
 * The pins that matter, in plan order:
 *  - an import covered by manifest `depends_on` passes WITHOUT any whitelist;
 *  - the same import minus the manifest edge fails;
 *  - the linter-config whitelist still grants extra-manifest allowances.
 * Plus the precedence ladder: `cannot_import` (the explicit denial) beats a
 * manifest grant; shared-kernel-typed contexts are importable from everywhere;
 * `restricted_to` still closes over UNdeclared imports but not over declared
 * ones (union doctrine — see the ADR).
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { LinterConfig } from "../src/subpath-violation.js";
import {
  buildManifestImportGrants,
  isCrossPackageViolation,
  isGlobalWhitelisted,
  type ManifestImportGrants,
} from "../src/cross-package-violation.js";

const SCOPE = "@acme";
const NO_CONFIG: LinterConfig = {};
const NO_GRANTS: ManifestImportGrants = buildManifestImportGrants([]);

const grantsOf = (
  contexts: { name: string; type?: string; depends_on?: string[] }[],
) => buildManifestImportGrants(contexts);

describe("buildManifestImportGrants", () => {
  it("collects depends_on per context and shared-kernel-typed contexts", () => {
    const grants = grantsOf([
      { name: "shared", type: "shared-kernel" },
      { name: "billing", type: "core", depends_on: ["orders", "shared"] },
      { name: "orders", type: "core", depends_on: [] },
    ]);
    assert.deepEqual(grants.dependsOn.get("billing"), ["orders", "shared"]);
    assert.equal(grants.dependsOn.has("orders"), false); // empty list omitted
    assert.ok(grants.sharedKernels.has("shared"));
    assert.equal(grants.sharedKernels.has("billing"), false);
  });

  it("tolerates an undefined bounded_contexts array", () => {
    const grants = buildManifestImportGrants(undefined);
    assert.equal(grants.dependsOn.size, 0);
    assert.equal(grants.sharedKernels.size, 0);
  });
});

describe("isCrossPackageViolation — manifest depends_on (ADR-0043)", () => {
  const grants = grantsOf([
    { name: "billing", type: "core", depends_on: ["orders"] },
    { name: "orders", type: "core" },
  ]);

  it("an import covered by depends_on passes without any whitelist", () => {
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/orders",
        "orders",
        SCOPE,
        NO_CONFIG,
        grants,
      ),
      false,
    );
  });

  it("the depends_on grant covers deep subpaths of the declared package", () => {
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/orders/domain/invoice",
        "orders",
        SCOPE,
        NO_CONFIG,
        grants,
      ),
      false,
    );
  });

  it("the same import minus the manifest edge fails", () => {
    // orders does NOT declare billing.
    assert.equal(
      isCrossPackageViolation(
        "orders",
        "@acme/billing",
        "billing",
        SCOPE,
        NO_CONFIG,
        grants,
      ),
      true,
    );
  });

  it("depends_on is directional — declaring an edge does not legalize the reverse import", () => {
    assert.equal(
      isCrossPackageViolation(
        "orders",
        "@acme/billing",
        "billing",
        SCOPE,
        NO_CONFIG,
        grantsOf([{ name: "billing", type: "core", depends_on: ["orders"] }]),
      ),
      true,
    );
  });
});

describe("isCrossPackageViolation — shared-kernel grant", () => {
  it("a shared-kernel-typed context is importable from everywhere, undeclared", () => {
    const grants = grantsOf([
      { name: "core-domain", type: "shared-kernel" },
      { name: "billing", type: "core" },
    ]);
    // Note: a config IS present and its whitelist does NOT cover core-domain,
    // so the pass can only come from the shared-kernel grant.
    const config: LinterConfig = { global_whitelist: ["@acme/shared"] };
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/core-domain",
        "core-domain",
        SCOPE,
        config,
        grants,
      ),
      false,
    );
  });
});

describe("isCrossPackageViolation — invariants config remains operative", () => {
  it("the global whitelist still grants extra-manifest allowances", () => {
    const config: LinterConfig = {
      global_whitelist: ["@acme/shared", "@acme/telemetry/**"],
    };
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/telemetry/traces",
        "telemetry",
        SCOPE,
        config,
        NO_GRANTS,
      ),
      false,
    );
  });

  it("package_rules allowed_imports still grant extra-manifest allowances", () => {
    const config: LinterConfig = {
      package_rules: [{ name: "billing", allowed_imports: ["@acme/orders"] }],
    };
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/orders",
        "orders",
        SCOPE,
        config,
        NO_GRANTS,
      ),
      false,
    );
  });

  it("cannot_import (explicit denial) beats a depends_on grant", () => {
    const grants = grantsOf([
      { name: "billing", type: "core", depends_on: ["orders"] },
    ]);
    const config: LinterConfig = {
      package_rules: [{ name: "billing", cannot_import: ["orders"] }],
    };
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/orders",
        "orders",
        SCOPE,
        config,
        grants,
      ),
      true,
    );
  });

  it("restricted_to still closes over imports NOT declared in the manifest", () => {
    const config: LinterConfig = {
      package_rules: [{ name: "billing", restricted_to: ["@acme/orders"] }],
    };
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/payments",
        "payments",
        SCOPE,
        config,
        NO_GRANTS,
      ),
      true,
    );
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/orders",
        "orders",
        SCOPE,
        config,
        NO_GRANTS,
      ),
      false,
    );
  });

  it("a manifest-declared edge passes despite an unrelated restricted_to (union doctrine)", () => {
    const grants = grantsOf([
      { name: "billing", type: "core", depends_on: ["payments"] },
    ]);
    const config: LinterConfig = {
      package_rules: [{ name: "billing", restricted_to: ["@acme/orders"] }],
    };
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/payments",
        "payments",
        SCOPE,
        config,
        grants,
      ),
      false,
    );
  });
});

describe("isCrossPackageViolation — non-cross-package cases", () => {
  it("non-scope and same-package imports are never violations", () => {
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "node:path",
        "",
        SCOPE,
        NO_CONFIG,
        NO_GRANTS,
      ),
      false,
    );
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/billing/domain",
        "billing",
        SCOPE,
        NO_CONFIG,
        NO_GRANTS,
      ),
      false,
    );
  });

  it("a prefix-sibling scope is not in-scope (slash boundary)", () => {
    // @acme-monaco shares the "@acme" prefix but is a DIFFERENT scope — the
    // published-tooling situation (@hexagen vs @hexagen-monaco). Doctrine:
    // namespacing.test.ts TOOLING_SCOPES match with the "/" boundary.
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme-monaco/foo",
        "foo",
        SCOPE,
        NO_CONFIG,
        NO_GRANTS,
      ),
      false,
    );
  });

  it("the default whitelist (no config) still admits the shared kernel", () => {
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/shared",
        "shared",
        SCOPE,
        NO_CONFIG,
        NO_GRANTS,
      ),
      false,
    );
    // …and ONLY the shared kernel: anything else stays a violation.
    assert.equal(
      isCrossPackageViolation(
        "billing",
        "@acme/orders",
        "orders",
        SCOPE,
        NO_CONFIG,
        NO_GRANTS,
      ),
      true,
    );
  });
});

describe("isGlobalWhitelisted", () => {
  it("matches exact entries and /** globs, defaults to the shared kernel", () => {
    assert.ok(isGlobalWhitelisted("@acme/shared", SCOPE, NO_CONFIG));
    assert.equal(isGlobalWhitelisted("@acme/orders", SCOPE, NO_CONFIG), false);
    const config: LinterConfig = { global_whitelist: ["@acme/shared/**"] };
    assert.ok(isGlobalWhitelisted("@acme/shared/utils", SCOPE, config));
    // An explicit whitelist REPLACES the default, and the /** glob requires
    // a subpath — bare @acme/shared does not match a glob-only list
    // (pre-existing semantics, pinned; scaffolds emit both forms for this).
    assert.equal(isGlobalWhitelisted("@acme/shared", SCOPE, config), false);
  });
});
