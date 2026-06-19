import { describe, it } from "vitest";
import assert from "node:assert";
import { normalizeStubName } from "../../src/generators/stubs.js";

// #242: a manifest layer name becomes BOTH a stub file stem and a TS identifier.
// normalizeStubName strips the kind's own extension (the part of the naming
// template AFTER the last `{name}`) if the raw value already carries it, then
// PascalCases. It must work for suffix-only templates AND templates with a
// prefix/path/placeholder before `{name}` (the CodeRabbit/qodo review finding).

describe("normalizeStubName", () => {
  it("no-op for an already-clean PascalCase name", () => {
    assert.equal(
      normalizeStubName("OrderRepository", "{name}.out-port.ts"),
      "OrderRepository",
    );
  });

  it("strips an already-present kind extension (no doubling)", () => {
    assert.equal(
      normalizeStubName("rest-controller.in-port.ts", "{name}.in-port.ts"),
      "RestController",
    );
    assert.equal(
      normalizeStubName("Prisma.adapter.ts", "{name}.adapter.ts"),
      "Prisma",
    );
  });

  it("PascalCases a bare kebab name (valid identifier)", () => {
    assert.equal(
      normalizeStubName("relational-db", "{name}.out-port.ts"),
      "RelationalDb",
    );
  });

  it("handles a naming template with a path/prefix before {name} (review fix)", () => {
    // Pre-fix these returned RestControllerInPortTs (whole-template-minus-token).
    assert.equal(
      normalizeStubName(
        "rest-controller.in-port.ts",
        "ports/in/{name}.in-port.ts",
      ),
      "RestController",
    );
    assert.equal(
      normalizeStubName(
        "rest-controller.in-port.ts",
        "generated-{name}.in-port.ts",
      ),
      "RestController",
    );
    assert.equal(
      normalizeStubName(
        "rest-controller.in-port.ts",
        "{scope}-{name}.in-port.ts",
      ),
      "RestController",
    );
  });

  it("strips a bare `.ts` (entity template) and is a no-op for clean entities", () => {
    assert.equal(normalizeStubName("Order.ts", "{name}.ts"), "Order");
    assert.equal(normalizeStubName("Order", "{name}.ts"), "Order");
  });

  it("guarantees a valid identifier start for digit-leading names", () => {
    assert.equal(
      normalizeStubName("3d-renderer", "{name}.in-port.ts"),
      "Stub3dRenderer",
    );
  });

  it("falls back to 'Stub' when normalization empties the name", () => {
    assert.equal(normalizeStubName("---", "{name}.in-port.ts"), "Stub");
  });

  it("leaves the name intact when the template has no {name} placeholder", () => {
    assert.equal(
      normalizeStubName("rest-controller", "fixed.ts"),
      "RestController",
    );
  });
});
