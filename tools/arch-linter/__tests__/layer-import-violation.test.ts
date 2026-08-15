/**
 * Layer-import policy (GOD-002 split guard).
 *
 * These predicates were extracted verbatim from the inline domain/application
 * checks that used to live in `checkArchitecturalIntegrity()`. Before the split
 * they were untestable — the only way to exercise them was to run the CLI, which
 * walks the filesystem for a manifest and `process.exit`s. This suite pins the
 * behaviors a NAIVE extraction would silently flatten:
 *
 *  1. Rule resolution precedence: a `<package>/<layer>` override beats a bare
 *     `<layer>` rule, which beats the `application` default.
 *  2. The domain-vs-application ASYMMETRY on `<scope>/shared`: the application
 *     layer short-circuits `${scope}/shared` to allowed when the shared kernel is
 *     enabled; the domain layer does NOT (it must match `${scope}/shared` the
 *     hard way, by the import path landing under the shared package dir). This is
 *     the one place the two inline call sites differed, and it is exactly what a
 *     "just unify the two loops" extraction would break.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  getLayerAllowedImports,
  importPathSatisfiesLayers,
  isSharedKernelAllowed,
  type LayerRules,
} from "../src/layer-import-violation.js";

const SCOPE = "@hexagen";
const WS = "packages";

describe("getLayerAllowedImports — rule resolution precedence", () => {
  it("falls back to [domain, scope] when there are no layer rules", () => {
    assert.deepEqual(getLayerAllowedImports("/x/domain/y.ts", {}, SCOPE), [
      "domain",
      SCOPE,
    ]);
  });

  it("prefers a <package>/<layer> override over a bare <layer> rule", () => {
    const rules: LayerRules = {
      layers: {
        application: { access_rule: "x", allowed_imports: ["domain"] },
        "billing/application": {
          access_rule: "x",
          allowed_imports: ["domain", `${SCOPE}/shared`, `${SCOPE}/payments`],
        },
      },
    };
    // A file under packages/billing/application/ must pick the scoped override,
    // not the bare `application` rule.
    assert.deepEqual(
      getLayerAllowedImports(
        "/repo/packages/billing/application/svc.ts",
        rules,
        SCOPE,
      ),
      ["domain", `${SCOPE}/shared`, `${SCOPE}/payments`],
    );
    // A file under a DIFFERENT package's application layer gets the bare rule.
    assert.deepEqual(
      getLayerAllowedImports(
        "/repo/packages/orders/application/svc.ts",
        rules,
        SCOPE,
      ),
      ["domain"],
    );
  });

  it("uses the application rule as the terminal default with the shared token", () => {
    const rules: LayerRules = {
      layers: { application: { access_rule: "x" } },
    };
    assert.deepEqual(
      getLayerAllowedImports("/repo/packages/x/infra/svc.ts", rules, SCOPE),
      ["domain", `${SCOPE}/shared`],
    );
  });
});

describe("isSharedKernelAllowed", () => {
  it("defaults to true when unspecified", () => {
    assert.equal(isSharedKernelAllowed({}), true);
  });
  it("honors an explicit false", () => {
    assert.equal(
      isSharedKernelAllowed({
        shared_kernel: { package: "shared", allowed_in_all_layers: false },
      }),
      false,
    );
  });
});

describe("importPathSatisfiesLayers — domain vs application asymmetry", () => {
  const allowed = ["domain", `${SCOPE}/shared`];
  // An import that resolves to a file OUTSIDE both the `domain/` dir and the
  // shared package dir — e.g. another package's application layer.
  const foreignImport = "/repo/packages/payments/application/api.ts";

  it("APPLICATION layer: shared kernel enabled → ${scope}/shared short-circuits to allowed", () => {
    // sharedKernelAllowed=true is the application call site. Even though the
    // imported file is not under packages/shared/, the `${scope}/shared` token
    // is treated as satisfied because the kernel is globally importable.
    assert.equal(
      importPathSatisfiesLayers(foreignImport, allowed, SCOPE, WS, true),
      true,
    );
  });

  it("DOMAIN layer: no short-circuit → the same import is NOT allowed", () => {
    // sharedKernelAllowed defaults to false (the domain call site never passed
    // the flag). `${scope}/shared` must be matched structurally, so a foreign
    // application-layer import is rejected.
    assert.equal(
      importPathSatisfiesLayers(foreignImport, allowed, SCOPE, WS),
      false,
    );
  });

  it("DOMAIN layer: a real shared-package import still matches via the scoped-token path", () => {
    // `${scope}/shared` → packages/shared/ ; an import landing there is allowed
    // in BOTH layers, short-circuit or not.
    const sharedImport = "/repo/packages/shared/src/logger.ts";
    assert.equal(
      importPathSatisfiesLayers(sharedImport, allowed, SCOPE, WS),
      true,
    );
    assert.equal(
      importPathSatisfiesLayers(sharedImport, allowed, SCOPE, WS, true),
      true,
    );
  });

  it("matches a bare layer token by directory segment (posix and win32)", () => {
    assert.equal(
      importPathSatisfiesLayers(
        "/repo/packages/x/domain/model.ts",
        ["domain"],
        SCOPE,
        WS,
      ),
      true,
    );
    assert.equal(
      importPathSatisfiesLayers(
        "C:\\repo\\packages\\x\\domain\\model.ts",
        ["domain"],
        SCOPE,
        WS,
      ),
      true,
    );
  });
});
