/**
 * Unit-level pins for the AUD-011 predicates (ADR-0054 §2).
 *
 * The CLI suite (`cli-layer-purity-ratchet.test.ts`) proves the rules are wired
 * into the bin at all — the defect class here was "policy exists, CLI never
 * calls it". This suite pins the policy EDGES that a fixture project would not
 * naturally exercise, and in particular the deliberate non-findings: a rule that
 * fires on everything is as useless as one that fires on nothing.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  checkCrossLayerRelativeImport,
  checkNodeBuiltinInLayer,
  checkNpmPackageInDomain,
  detectLayer,
  isDomainPackageAllowed,
  isNodeBuiltinSpecifier,
  isWorkspaceSpecifier,
  npmPackageNameOf,
  resolveFileHexagonalLayer,
  resolveRelativeImportPath,
} from "../src/layer-purity-violation.js";

const SCOPE = "@acme";
const WS = "packages";
const DOMAIN_FILE = "/repo/packages/billing/src/domain/model/invoice.ts";
const APP_FILE = "/repo/packages/billing/src/application/charge.use-case.ts";

describe("isNodeBuiltinSpecifier", () => {
  it("accepts the node: prefix, bare builtins, and builtin subpaths", () => {
    for (const spec of [
      "node:fs",
      "node:fs/promises",
      "fs",
      "fs/promises",
      "path",
      "crypto",
    ]) {
      assert.equal(isNodeBuiltinSpecifier(spec), true, spec);
    }
  });

  it("does not mistake npm packages or relative paths for builtins", () => {
    for (const spec of [
      "js-yaml",
      "@acme/shared",
      "./path.js",
      "path-to-regexp",
      "node-fetch",
    ]) {
      assert.equal(isNodeBuiltinSpecifier(spec), false, spec);
    }
  });
});

describe("npmPackageNameOf", () => {
  it("strips subpaths and keeps the scope", () => {
    assert.equal(npmPackageNameOf("js-yaml"), "js-yaml");
    assert.equal(npmPackageNameOf("js-yaml/dist/js-yaml.mjs"), "js-yaml");
    assert.equal(npmPackageNameOf("@octokit/rest"), "@octokit/rest");
    assert.equal(
      npmPackageNameOf("@octokit/rest/dist/index.js"),
      "@octokit/rest",
    );
  });

  it("returns null for relative specifiers and a bare '@'", () => {
    assert.equal(npmPackageNameOf("./x.js"), null);
    assert.equal(npmPackageNameOf("../../y.js"), null);
    // A path-alias style specifier is not a package name.
    assert.equal(npmPackageNameOf("@"), null);
  });
});

describe("detectLayer", () => {
  it("classifies by path segment, deepest match wins", () => {
    assert.equal(detectLayer(DOMAIN_FILE), "domain");
    assert.equal(detectLayer(APP_FILE), "application");
    assert.equal(
      detectLayer("/repo/packages/x/src/application/svc/domain/rule.ts"),
      "domain",
    );
  });

  it("returns null for a file in no layer, and never matches a partial segment", () => {
    assert.equal(detectLayer("/repo/packages/x/src/config.ts"), null);
    // 'domain-events' is not the 'domain' layer.
    assert.equal(detectLayer("/repo/packages/x/src/domain-events/e.ts"), null);
  });
});

describe("resolveFileHexagonalLayer — layout-mapped directories", () => {
  const ctx = "/repo/packages/billing";
  const layers = {
    domain: ["src/core"],
    application: ["src/services"],
    infrastructure: ["src/db", "src/http"],
  };

  it("maps src/core to domain and src/services to application", () => {
    assert.equal(
      resolveFileHexagonalLayer(`${ctx}/src/core/invoice.ts`, {
        contextRootAbs: ctx,
        layerDirs: layers,
      }),
      "domain",
    );
    assert.equal(
      resolveFileHexagonalLayer(`${ctx}/src/services/charge.ts`, {
        contextRootAbs: ctx,
        layerDirs: layers,
      }),
      "application",
    );
  });

  it("falls back to path-segment detection when no layer dirs are given", () => {
    assert.equal(
      resolveFileHexagonalLayer(`${ctx}/src/domain/invoice.ts`, {
        contextRootAbs: ctx,
      }),
      "domain",
    );
  });
});

describe("resolveRelativeImportPath", () => {
  it("resolves against the importing file's directory", () => {
    assert.equal(
      resolveRelativeImportPath(DOMAIN_FILE, "../../infrastructure/db.js"),
      "/repo/packages/billing/src/infrastructure/db.js",
    );
  });
});

describe("checkCrossLayerRelativeImport", () => {
  const base = {
    filePath: DOMAIN_FILE,
    sourceLayer: "domain",
    allowed: [`${SCOPE}/shared`],
    scope: SCOPE,
    workspacesDir: WS,
  };

  it("flags a domain file reaching into infrastructure", () => {
    const v = checkCrossLayerRelativeImport({
      ...base,
      moduleSpecifier: "../../infrastructure/db.js",
    });
    assert.equal(v?.rule, "cross-layer-relative-import");
    assert.match(
      v!.detail,
      /crosses out of the 'domain' layer into 'infrastructure'/,
    );
  });

  it("does NOT flag a same-layer import, whatever allowed_imports says", () => {
    // The host's `domain` rule lists only scoped packages; without the
    // same-layer short-circuit every intra-domain import in the repo would be
    // a violation.
    assert.equal(
      checkCrossLayerRelativeImport({
        ...base,
        moduleSpecifier: "./money.js",
      }),
      null,
    );
    assert.equal(
      checkCrossLayerRelativeImport({
        ...base,
        moduleSpecifier: "../services/pricing.js",
      }),
      null,
    );
  });

  it("does NOT flag a cross-layer import the layer rules allow", () => {
    assert.equal(
      checkCrossLayerRelativeImport({
        filePath: APP_FILE,
        sourceLayer: "application",
        allowed: ["domain", `${SCOPE}/shared`],
        scope: SCOPE,
        workspacesDir: WS,
        moduleSpecifier: "../domain/model/invoice.js",
      }),
      null,
    );
  });

  it("does NOT flag a BARREL import of an allowed layer", () => {
    // `../../domain` resolves to the layer DIRECTORY, so a `/domain/`
    // substring test on the resolved path misses it. Regression guard: this
    // shape (an application use-case importing its package's domain barrel)
    // exists in the host and must not be reported.
    assert.equal(
      checkCrossLayerRelativeImport({
        filePath: "/repo/packages/web-driver/src/application/use-cases/p.ts",
        sourceLayer: "application",
        allowed: ["domain", `${SCOPE}/shared`],
        scope: SCOPE,
        workspacesDir: WS,
        moduleSpecifier: "../../domain",
      }),
      null,
    );
  });

  it("does NOT flag a target that sits in no layer at all", () => {
    // e.g. `../../config.js` at package root — a composition-root leak, tracked
    // separately, not a layer-crossing.
    assert.equal(
      checkCrossLayerRelativeImport({
        ...base,
        moduleSpecifier: "../../config.js",
      }),
      null,
    );
  });

  it("ignores non-relative specifiers (they are other rules' business)", () => {
    assert.equal(
      checkCrossLayerRelativeImport({
        ...base,
        moduleSpecifier: "@acme/other",
      }),
      null,
    );
  });
});

describe("checkNodeBuiltinInLayer", () => {
  it("flags builtins in domain and application", () => {
    assert.equal(
      checkNodeBuiltinInLayer("domain", "node:fs")?.rule,
      "node-builtin-in-layer",
    );
    assert.equal(
      checkNodeBuiltinInLayer("application", "path")?.rule,
      "node-builtin-in-layer",
    );
  });

  it("leaves infrastructure and presentation alone", () => {
    assert.equal(checkNodeBuiltinInLayer("infrastructure", "node:fs"), null);
    assert.equal(checkNodeBuiltinInLayer("presentation", "node:fs"), null);
  });
});

describe("checkNpmPackageInDomain", () => {
  const base = { contextName: "billing", scope: SCOPE };

  it("flags a bare npm package", () => {
    const v = checkNpmPackageInDomain({ ...base, moduleSpecifier: "js-yaml" });
    assert.equal(v?.rule, "npm-package-in-domain");
    assert.match(v!.detail, /npm package 'js-yaml'/);
  });

  it("honours the per-context allowlist, including subpath imports", () => {
    const allowlist = [{ package: "billing", allowed_packages: ["js-yaml"] }];
    assert.equal(
      checkNpmPackageInDomain({
        ...base,
        moduleSpecifier: "js-yaml",
        allowlist,
      }),
      null,
    );
    assert.equal(
      checkNpmPackageInDomain({
        ...base,
        moduleSpecifier: "js-yaml/dist/js-yaml.mjs",
        allowlist,
      }),
      null,
    );
    // Another context does not inherit the exception.
    assert.notEqual(
      checkNpmPackageInDomain({
        ...base,
        contextName: "shipping",
        moduleSpecifier: "js-yaml",
        allowlist,
      }),
      null,
    );
  });

  it("skips workspace packages, builtins, and relative imports", () => {
    for (const spec of [
      "@acme/shared",
      "@acme/shared/server",
      "node:fs",
      "fs",
      "./x.js",
    ]) {
      assert.equal(
        checkNpmPackageInDomain({ ...base, moduleSpecifier: spec }),
        null,
        spec,
      );
    }
  });
});

describe("isWorkspaceSpecifier / isDomainPackageAllowed", () => {
  it("recognises the scope itself and its subpaths only", () => {
    assert.equal(isWorkspaceSpecifier("@acme", SCOPE), true);
    assert.equal(isWorkspaceSpecifier("@acme/shared", SCOPE), true);
    assert.equal(isWorkspaceSpecifier("@acme-labs/shared", SCOPE), false);
  });

  it("supports a '*' entry for a project-wide exception", () => {
    const allowlist = [{ package: "*", allowed_packages: ["zod"] }];
    assert.equal(isDomainPackageAllowed("zod", "anything", allowlist), true);
    assert.equal(
      isDomainPackageAllowed("js-yaml", "anything", allowlist),
      false,
    );
  });

  it("treats a missing allowed_packages list as granting nothing", () => {
    assert.equal(
      isDomainPackageAllowed("zod", "billing", [{ package: "billing" }]),
      false,
    );
  });
});
