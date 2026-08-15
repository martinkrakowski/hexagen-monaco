import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { POST } from "../route";
import { analyzeManifest } from "../../../../lib/governance/manifest-analysis";
import { MAX_MANIFEST_YAML_CHARS } from "../../../../lib/request-guards";

function postJson(manifestYaml: unknown) {
  return new Request("http://localhost/api/governance/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(manifestYaml === undefined ? {} : { manifestYaml }),
  });
}

/** POST an arbitrary raw JSON value as the whole body (e.g. `null`). */
function postRawBody(value: unknown) {
  return new Request("http://localhost/api/governance/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("POST /api/governance/status", () => {
  it("400s when manifestYaml is missing", async () => {
    const res = await POST(postJson(undefined));
    assert.equal(res.status, 400);
  });

  it("400s a null JSON body instead of throwing to a 500", async () => {
    // `JSON.stringify(null)` → "null"; a bare `null` body would make
    // `body.manifestYaml` throw (→ 500) without the shape guard.
    const res = await POST(postRawBody(null));
    assert.equal(res.status, 400);
  });

  it("400s an object-valued manifestYaml (would slip past the size guard)", async () => {
    const res = await POST(postJson({ nested: true }));
    assert.equal(res.status, 400);
  });

  it("400s when the manifest exceeds the size cap (bounds yaml.load DoS surface)", async () => {
    const res = await POST(postJson("a".repeat(MAX_MANIFEST_YAML_CHARS + 1)));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too large/i);
  });

  it("surfaces a parse failure as an error rather than an empty-but-healthy status (AUD-005)", async () => {
    const res = await POST(postJson("bounded_contexts: [unclosed"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.status, []);
    assert.ok(typeof body.error === "string" && body.error.length > 0);
  });

  it("returns exactly the shared analyzer's status for a valid manifest (one source of truth)", async () => {
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
    const analysis = analyzeManifest(manifest);
    assert.equal(analysis.ok, true);
    if (analysis.ok) {
      // The route must not re-derive status; it delegates to the shared module,
      // so `status` and `refresh` agree on the same manifest.
      assert.deepEqual(body.status, analysis.status);
    }
  });
});
