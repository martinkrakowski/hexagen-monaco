import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { POST, GET } from "../route";
import { MAX_MANIFEST_YAML_CHARS } from "../../../../lib/request-guards";

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

  it("400s when the manifest exceeds the size cap (bounds yaml.load DoS surface)", async () => {
    const res = await POST(postJson("a".repeat(MAX_MANIFEST_YAML_CHARS + 1)));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too large/i);
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

  it("a malformed bounded_contexts shape is NOT compliant (AUD-005)", async () => {
    // `bounded_contexts: {}` parses but is not a context list; the analyzer now
    // returns ok:false and the route must render it non-compliant, not green.
    const res = await POST(postJson("bounded_contexts: {}"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.isCompliant, false);
    assert.ok(
      body.violations.some(
        (v: { id: string }) => v.id === "manifest-parse-error",
      ),
      "surfaces the malformed-shape error as a violation",
    );
  });

  it("a bounded_contexts list of bare scalars is NOT compliant (AUD-005)", async () => {
    // `bounded_contexts: [a, b]` parses to an array whose elements are not
    // context mappings; the analyzer rejects it (ok:false) and the route must
    // render it non-compliant instead of a false-green empty result.
    const res = await POST(postJson("bounded_contexts: [alpha, beta]"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.isCompliant, false);
    assert.ok(
      body.violations.some(
        (v: { id: string }) => v.id === "manifest-parse-error",
      ),
      "surfaces the malformed-list error as a violation",
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
