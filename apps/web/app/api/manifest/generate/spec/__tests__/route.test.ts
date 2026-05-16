import { test, describe } from "node:test";
import assert from "node:assert";
import { POST } from "../route";

describe("POST /api/manifest/generate/spec", () => {
  test("missing config returns error with Missing config message", async () => {
    const request = new Request("http://localhost/api/manifest/generate/spec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request as unknown as Request);
    assert.strictEqual(response.status, 400);

    const data = await response.json();
    assert.strictEqual(data.type, "error");
    assert.strictEqual(data.message, "Missing config");
  });

  test("invalid JSON in body returns error", async () => {
    const request = new Request("http://localhost/api/manifest/generate/spec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json",
    });

    const response = await POST(request as unknown as Request);
    assert.strictEqual(response.status, 400);

    const data = await response.json();
    assert.strictEqual(data.type, "error");
    assert.strictEqual(data.message, "Invalid JSON");
  });

  test("invalid YAML in config returns error via NDJSON stream", async () => {
    const request = new Request("http://localhost/api/manifest/generate/spec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: "invalid: [}" }),
    });

    const response = await POST(request as unknown as Request);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get("Content-Type"),
      "application/x-ndjson",
    );

    const text = await response.text();
    const lines = text.trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 1);

    const event = JSON.parse(lines[0]);
    assert.strictEqual(event.type, "error");
    assert.ok(event.message.includes("Config must be valid YAML"));
  });

  test("config without intent returns error via NDJSON stream", async () => {
    const config = yamlString({ name: "test" });
    const request = new Request("http://localhost/api/manifest/generate/spec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });

    const response = await POST(request as unknown as Request);
    const text = await response.text();
    const lines = text.trim().split("\n").filter(Boolean);
    const event = JSON.parse(lines[0]);

    assert.strictEqual(event.type, "error");
    assert.ok(event.message.includes("intent"));
  });

  test("valid config is parsed into StructuredConfigInput fields", async () => {
    const config = yamlString({
      intent: "build a project",
      explicitTechnologies: ["React", "Node.js"],
      subdomains: ["frontend", "backend"],
      classifiedContexts: [{ name: "web" }],
    });

    const request = new Request("http://localhost/api/manifest/generate/spec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config,
        platform: "web",
        deployment: "cloud",
        additionalContext: "extra info",
      }),
    });

    const response = await POST(request as unknown as Request);
    assert.strictEqual(response.status, 200);

    const text = await response.text();
    assert.ok(text.length > 0);
    const lines = text.trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 1);
  });
});

function yamlString(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}:\n${v.map((i: unknown) => `  - ${JSON.stringify(i)}`).join("\n")}`;
      }
      return `${k}: ${v}`;
    })
    .join("\n");
}
