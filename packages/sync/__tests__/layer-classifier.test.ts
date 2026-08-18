import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  determineLayer,
  determinePackageName,
} from "../src/domain/services/layer-classifier.js";

const LAYOUT = {
  contexts: {
    billing: {
      root: "packages/billing",
      layers: {
        domain: ["src/core"],
        application: ["src/services"],
        infrastructure: ["src/db", "src/http"],
      },
    },
    identity: {
      root: "packages/auth",
    },
  },
};

describe("determineLayer — convention mode (no layout)", () => {
  it("classifies hexagonal path segments", () => {
    assert.equal(
      determineLayer("packages/billing/src/domain/model/invoice.ts"),
      "domain",
    );
    assert.equal(
      determineLayer("packages/billing/src/application/charge.use-case.ts"),
      "application",
    );
    assert.equal(
      determineLayer("packages/billing/src/infrastructure/db.adapter.ts"),
      "infrastructure",
    );
  });

  it("does not treat src/core as domain without a layout", () => {
    assert.equal(
      determineLayer("packages/billing/src/core/invoice.ts"),
      "unknown",
    );
  });
});

describe("determineLayer — layout-aware mode", () => {
  it("maps configured directories onto hexagonal layers", () => {
    assert.equal(
      determineLayer("packages/billing/src/core/invoice.ts", LAYOUT),
      "domain",
    );
    assert.equal(
      determineLayer("packages/billing/src/services/charge.ts", LAYOUT),
      "application",
    );
    assert.equal(
      determineLayer("packages/billing/src/db/client.ts", LAYOUT),
      "infrastructure",
    );
  });

  it("falls back to convention when the layout has no layer dirs for that context", () => {
    assert.equal(
      determineLayer("packages/auth/src/domain/user.ts", LAYOUT),
      "domain",
    );
  });
});

describe("determinePackageName — layout-aware mode", () => {
  it("uses the context name whose root contains the file", () => {
    assert.equal(
      determinePackageName("packages/auth/src/domain/user.ts", LAYOUT),
      "identity",
    );
    assert.equal(
      determinePackageName("packages/billing/src/core/invoice.ts", LAYOUT),
      "billing",
    );
  });

  it("selects the deepest matching context regardless of declaration order", () => {
    const nestedFile = "packages/billing/src/core/invoice.ts";
    const broadFirst = {
      contexts: {
        monorepo: { root: "packages" },
        billing: {
          root: "packages/billing",
          layers: { domain: ["src/core"] },
        },
      },
    };
    const nestedFirst = {
      contexts: {
        billing: {
          root: "packages/billing",
          layers: { domain: ["src/core"] },
        },
        monorepo: { root: "packages" },
      },
    };
    assert.equal(determinePackageName(nestedFile, broadFirst), "billing");
    assert.equal(determinePackageName(nestedFile, nestedFirst), "billing");
    assert.equal(determineLayer(nestedFile, broadFirst), "domain");
    assert.equal(determineLayer(nestedFile, nestedFirst), "domain");
    assert.equal(
      determinePackageName("packages/auth/src/user.ts", broadFirst),
      "monorepo",
    );
  });

  it("maps a custom context layer name such as services", () => {
    assert.equal(
      determineLayer("packages/billing/src/services/charge.ts", {
        contexts: {
          billing: {
            root: "packages/billing",
            layers: { services: ["src/services"] },
          },
        },
      }),
      "services",
    );
  });

  it("keeps the packages/apps convention when no layout is given", () => {
    assert.equal(
      determinePackageName("packages/billing/src/domain/invoice.ts"),
      "billing",
    );
  });
});
