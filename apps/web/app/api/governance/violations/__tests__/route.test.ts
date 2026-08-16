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

/** POST an arbitrary raw JSON value as the whole body (e.g. `null`). */
function postRawBody(value: unknown) {
  return new Request("http://localhost/api/governance/violations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

/** POST a syntactically invalid (un-parseable) JSON body. */
function postMalformed() {
  return new Request("http://localhost/api/governance/violations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ this is not valid json ",
  });
}

describe("POST /api/governance/violations", () => {
  it("400s when manifestYaml is missing", async () => {
    const res = await POST(postJson(undefined));
    assert.equal(res.status, 400);
  });

  it("400s a malformed JSON body instead of a 500 (client error, not server error)", async () => {
    const res = await POST(postMalformed());
    assert.equal(res.status, 400);
    // Assert the parse-guard's OWN message, not just any 400 — so this can't be
    // silently satisfied by guardManifestBody 400ing an undefined body instead.
    const body = await res.json();
    assert.match(body.error, /valid json/i);
  });

  it("400s a null JSON body instead of throwing to a 500", async () => {
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
      // `depends_on` — the key the manifest schema declares and every real
      // context.yaml writes. This fixture used to say `dependencies`, a key no
      // manifest has ever had, and stayed green because the analyzer read the
      // same phantom key back (dossier §2.2).
      "    depends_on:",
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
      // Adapters belong under `infrastructure`, per BoundedContextSchema.
      "      infrastructure:",
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
