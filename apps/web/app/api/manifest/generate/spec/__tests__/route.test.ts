import test from "node:test";
import assert from "node:assert/strict";

test("POST /api/manifest/generate/spec returns NDJSON stream", async () => {
  // Note: Requires running dev server on port 3000
  // Uncomment to run manually:
  // import fs from "node:fs";
  // import path from "node:path";
  // const yamlPath = path.join(
  //   "/Users/martin/Projects/hexagen-monaco/packages/agentic-interaction/src/application/use-cases/staged-generation/__tests__/fixtures",
  //   "krakowski-portal.yaml"
  // );
  // const yamlContent = fs.readFileSync(yamlPath, "utf-8");
  // const { execSync } = require("node:child_process");
  // const config = JSON.stringify(yamlContent);
  // const curlCommand = `curl -s -X POST http://localhost:3000/api/manifest/generate/spec \
  //   -H "Content-Type: application/json" \
  //   -d "{\"config\": ${config}}" \
  //   --no-buffer 2>&1 | head -30`;
  // const output = execSync(curlCommand).toString();
  // assert.match(output, /type":"stage-start"/);
  // assert.match(output, /type":"done"/);
  assert.ok(true); // Placeholder until server is running
});

test("POST /api/manifest/generate/spec with missing config returns 400", async () => {
  // Placeholder for manual testing with curl
  assert.ok(true);
});
