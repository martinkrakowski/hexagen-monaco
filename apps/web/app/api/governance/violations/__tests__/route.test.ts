import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { POST, GET } from "../route";

function postJson(manifestYaml: unknown) {
  return new Request("http://localhost/api/governance/violations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(manifestYaml === undefined ? {} : { manifestYaml }),
  });
}

describe("POST /api/governance/violations", () => {
  it("400s when manifestYaml is missing", async () => {
    const res = await POST(postJson(undefined));
    assert.equal(res.status, 400);
  });

  it("a manifest that will not parse is NOT compliant (AUD-005)", async () => {
    const res = await POST(postJson("bounded_contexts: [unclosed"));
    assert.equal(res.status, 200);
    const body = await res.json();
    // Regression guard: the pre-unification route swallowed parse failures and
    // returned `isCompliant: true` with an empty violations list — a false green.
    assert.equal(body.isCompliant, false);
    assert.ok(
      body.violations.some(
        (v: { id: string }) => v.id === "manifest-parse-error",
      ),
      "surfaces an explicit parse-error violation",
    );
  });

  it("reports a self-dependency as an error → not compliant", async () => {
    const manifest = [
      "bounded_contexts:",
      "  - name: orders",
      "    dependencies:",
      "      - name: orders",
    ].join("\n");
    const res = await POST(postJson(manifest));
    const body = await res.json();
    assert.equal(body.isCompliant, false);
    assert.ok(
      body.violations.some((v: { type: string }) => v.type === "error"),
    );
  });

  it("reports a clean manifest as compliant with no errors", async () => {
    const manifest = [
      "bounded_contexts:",
      "  - name: ctx",
      "    layers:",
      "      application:",
      "        ports:",
      "          in: [A, B]",
      "      domain:",
      "        adapters:",
      "          AdapterA: {}",
    ].join("\n");
    const res = await POST(postJson(manifest));
    const body = await res.json();
    assert.equal(body.isCompliant, true);
    assert.ok(
      !body.violations.some((v: { type: string }) => v.type === "error"),
    );
  });
});

describe("GET /api/governance/violations", () => {
  it("405s and never claims compliance from a non-success response", async () => {
    const res = await GET();
    assert.equal(res.status, 405);
    const body = await res.json();
    assert.equal(body.isCompliant, false);
  });
});
