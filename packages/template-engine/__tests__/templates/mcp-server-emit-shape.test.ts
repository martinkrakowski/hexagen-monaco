import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FileSystemTemplateRegistry } from "../../src/infrastructure/template-registry.adapter.js";
import { createFileSystemTemplateFileLoader } from "../../src/infrastructure/file-system-template-file-loader.js";
import { InMemoryAddOnMaterializer } from "../../src/infrastructure/in-memory-add-on-materializer.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);
const materializer = new InMemoryAddOnMaterializer(
  new FileSystemTemplateRegistry(TEMPLATES_DIR),
  createFileSystemTemplateFileLoader(TEMPLATES_DIR),
);

const CORE = [
  "src/infrastructure/mcp/sdk.ts",
  "src/infrastructure/mcp/server.ts",
  "src/infrastructure/mcp/transport/stdio.ts",
  "src/infrastructure/mcp/transport/register-transports.ts",
  "src/infrastructure/mcp/registry/tool-registry.ts",
  "src/infrastructure/mcp/registry/register-all.ts",
  "src/infrastructure/mcp/tools/example.tool.ts",
  "bin/cli.ts",
  ".mcp.json.example",
  ".env.mcp.example",
];
const TEST_SCAFFOLDS = [
  "src/infrastructure/mcp/tools/example.tool.test.ts",
  "src/infrastructure/mcp/registry/tool-registry.test.ts",
];

describe("mcp-server template — emit shape", () => {
  it("emits the stdio base by default — no test scaffolds, gated resources/prompts off", async () => {
    const { files, errors } = await materializer.materialize(
      { "mcp-server": {} },
      { projectName: "acme" },
    );
    assert.deepEqual(
      errors,
      [],
      "a valid selection materializes without errors",
    );
    for (const rel of CORE) {
      assert.ok(files.has(rel), `expected core file ${rel}`);
    }
    for (const rel of TEST_SCAFFOLDS) {
      assert.ok(
        !files.has(rel),
        `${rel} must be gated off without --with-tests`,
      );
    }
    assert.ok(
      !files.has("src/infrastructure/mcp/resources/example.resource.ts"),
      "resources gated off by default",
    );
    assert.ok(
      !files.has("src/infrastructure/mcp/prompts/example.prompt.ts"),
      "prompts gated off by default",
    );
    assert.ok(
      [...files.keys()].some(
        (k) =>
          !k.startsWith("src/infrastructure/mcp/") &&
          k !== "bin/cli.ts" &&
          k !== ".mcp.json.example" &&
          k !== ".env.mcp.example",
      ),
      "env-setup (requires) co-emitted",
    );
  });

  it("emits node:test scaffolds only under --with-tests", async () => {
    const { files } = await materializer.materialize(
      { "mcp-server": {} },
      { projectName: "acme", withTests: true },
    );
    for (const rel of TEST_SCAFFOLDS) {
      assert.ok(
        files.has(rel),
        `expected test scaffold ${rel} under --with-tests`,
      );
    }
    assert.match(
      files.get(TEST_SCAFFOLDS[0]) ?? "",
      /from "node:test"/,
      "scaffolds target the generated core's runner (node:test)",
    );
  });

  it("resolves {projectName} into the server_name default (C4)", async () => {
    const { files } = await materializer.materialize(
      { "mcp-server": {} },
      { projectName: "acme" },
    );
    const server = files.get("src/infrastructure/mcp/server.ts") ?? "";
    assert.match(
      server,
      /"acme"/,
      "server_name default resolved to projectName",
    );
    assert.ok(
      !server.includes("{server_name}"),
      "no unresolved {server_name} placeholder",
    );
  });

  it("resolves {projectName} when server_name is supplied as an override answer", async () => {
    // Beyond the unanswered-default path: a caller that submits the raw
    // placeholder as the answer must still resolve (the emitter pre-resolves
    // string answers, since interpolate is single-pass).
    const { files } = await materializer.materialize(
      { "mcp-server": { server_name: "{projectName}" } },
      { projectName: "acme" },
    );
    const server = files.get("src/infrastructure/mcp/server.ts") ?? "";
    assert.match(server, /"acme"/);
    assert.ok(
      !server.includes("{projectName}") && !server.includes("{server_name}"),
      "no placeholder leaks through an override answer",
    );
  });

  it("emits gated resources/prompts when their booleans are set", async () => {
    const { files } = await materializer.materialize(
      { "mcp-server": { resources: true, prompts: true } },
      { projectName: "acme" },
    );
    assert.ok(
      files.has("src/infrastructure/mcp/resources/example.resource.ts"),
    );
    assert.ok(files.has("src/infrastructure/mcp/prompts/example.prompt.ts"));
  });
});
