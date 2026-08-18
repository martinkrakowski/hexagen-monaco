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

  it("keeps the packages/apps convention when no layout is given", () => {
    assert.equal(
      determinePackageName("packages/billing/src/domain/invoice.ts"),
      "billing",
    );
  });
});
