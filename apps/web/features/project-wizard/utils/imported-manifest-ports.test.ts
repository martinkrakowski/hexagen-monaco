import { describe, it } from "vitest";
import assert from "node:assert";
import { listImportedManifestPorts } from "./imported-manifest-ports";

describe("listImportedManifestPorts", () => {
  it("lists named ports per context, accepting string and {name} entries", () => {
    const result = listImportedManifestPorts(
      [
        "bounded_contexts:",
        "  - name: billing",
        "    layers:",
        "      application:",
        "        ports:",
        "          in:",
        "            - ProcessPaymentPort",
        "            - name: RefundPort",
        "          out: [PaymentGatewayPort]",
        "  - name: catalog",
      ].join("\n"),
    );
    assert.deepStrictEqual(result, [
      {
        context: "billing",
        inPorts: ["ProcessPaymentPort", "RefundPort"],
        outPorts: ["PaymentGatewayPort"],
      },
      { context: "catalog", inPorts: [], outPorts: [] },
    ]);
  });

  it("tolerates JSON text (pre-fix autosave stored JSON.stringify output)", () => {
    const result = listImportedManifestPorts(
      JSON.stringify({
        bounded_contexts: [
          {
            name: "core",
            layers: { application: { ports: { in: ["APort"], out: [] } } },
          },
        ],
      }),
    );
    assert.deepStrictEqual(result, [
      { context: "core", inPorts: ["APort"], outPorts: [] },
    ]);
  });

  it("degrades to [] on unparseable / empty / shapeless input (display-only, never blocks)", () => {
    assert.deepStrictEqual(listImportedManifestPorts("a: [unclosed"), []);
    assert.deepStrictEqual(listImportedManifestPorts(""), []);
    assert.deepStrictEqual(listImportedManifestPorts(null), []);
    assert.deepStrictEqual(listImportedManifestPorts(undefined), []);
    assert.deepStrictEqual(listImportedManifestPorts("just a string"), []);
    assert.deepStrictEqual(
      listImportedManifestPorts("bounded_contexts: not-an-array"),
      [],
    );
  });

  it("skips nameless contexts and non-string port entries without failing", () => {
    const result = listImportedManifestPorts(
      [
        "bounded_contexts:",
        "  - layers: {}",
        "  - name: ok",
        "    layers:",
        "      application:",
        "        ports:",
        "          in:",
        "            - 42",
        "            - name: RealPort",
      ].join("\n"),
    );
    assert.deepStrictEqual(result, [
      { context: "ok", inPorts: ["RealPort"], outPorts: [] },
    ]);
  });
});
